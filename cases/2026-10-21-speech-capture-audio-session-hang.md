---
date: 2026-10-21
area: functional
project: "Beatsketch"
platform: ios
status: fixed
title: 语音转文字卡死：播放引擎占着音频会话
symptom: 点麦克风开始语音转文字后界面停在 Listening，再点停止也会卡住
fix: 开录前停掉已在运行的 AVAudioEngine 并释放音频会话；停录时先摘掉 tap、停引擎，再异步 cancel 识别任务
error_signatures:
  - "AVAudioEngine"
  - "AVAudioSession.setCategory"
  - "SFSpeechRecognitionTask.cancel"
  - "Listening"
tags:
  - 录音
  - 听写
  - 语音转文字
  - 卡死
  - 卡顿
  - 麦克风
  - AVAudioEngine
  - speech
---

## 背景

iOS 应用里同时有两套 `AVAudioEngine`：一套在启动时就以 `.playback` 跑节拍/点击声，另一套在语音页用 `SFSpeechRecognizer` + `AVAudioEngine` 做本机听写。听写页把识别结果写回 Compose 的文本绑定，停止按钮在 `listening == true` 时被禁用。

## 现象

1. 用户打开 Voice，点麦克风或 “Arm mic”。
2. 界面进入 Listening 后不再往下走，或部分结果出来时整页发顿。
3. 想停掉时按钮不可点；点 Done 关闭时主线程卡住，sheet 关不掉。
4. 没有稳定的崩溃弹窗，表现是录音流程卡死。

## 定位

根因是共享音频会话被播放引擎占住，停录又在主线程同步取消识别：

- 节拍引擎在 `init` 里 `setCategory(.playback)`、`setActive(true)` 并 `engine.start()`，之后一直占着硬件。
- 听写再 `setCategory(.record)` 并启动第二台 `AVAudioEngine`。类别切换和 `inputNode` / `engine.start()` 发生在主线程，会堵住 UI，听写停在 Listening。
- 每个 partial 都写回父级 `@Binding` 文本，父页面整树重绘，听写过程中进一步卡顿。
- `stop()` 在主线程同步 `recognitionTask.cancel()`。识别回调或 Done 路径里这样取消，Speech 框架会把主线程拖死。
- `installTap` 前无条件 `removeTap`：没有 tap 时会抛异常，表现为一点录音就失败或卡住。

空 partial 把已有文案清掉是另一条根因，见 `cases/2026-10-18-speech-dictation-empty-partial-clears-text.md`，不要并进本案例。

## 修复

1. 开录前让播放引擎 `suspendForCapture()`：停 timer、`player.stop()`、`engine.stop()`，并对 `AVAudioSession` `setActive(false)`。
2. 听写改用 `.playAndRecord`，确认 `outputFormat` 的 `sampleRate > 0` 再 `installTap`；不要在没有 tap 时 `removeTap`。
3. 支持端侧识别时设 `requiresOnDeviceRecognition = true`。partial 只更新听写页本地文案，停止或 Done 时再写回父级绑定。
4. `stop()` 用标志防重入：先摘 tap、停引擎、`endAudio()`，把 `task.cancel()` 丢到下一轮 main，避免在识别回调栈里同步取消。
5. Listening 时按钮改为可再次点击以停止，不要 `disabled(listening)`。

## 适用边界

适用：

- 同一进程里已有播放用 `AVAudioEngine`（节拍器、预览、循环播放），再开 `SFSpeechRecognizer` 听写。
- 听写开始或停止时主线程卡住，界面停在 Listening，且没有 `comparisonTypeMismatch` 一类导航崩溃。

不适用：

- 只有一台引擎、会话类别没有被别的播放器占用的听写失败（先查权限、locale、`sampleRate == 0`）。
- 空 partial 覆盖输入框（用既有听写清空案例）。
- 识别准确率或网络 ASR 质量问题。

## 复盘（可迁移的规则）

开麦克风之前必须先停掉已经 `start()` 的播放 `AVAudioEngine` 并释放 `AVAudioSession`。停听写时不要在主线程同步 `cancel()` 识别任务：先摘 tap、停引擎、结束 request，再异步取消。听写进行中不要把每个 partial 写进外层大页面的绑定。

## 提交前检查

- 根因已定位，不是猜测。
- 标题或 symptom 能用 2 字通用中文词搜到（听写、卡死、麦克风）。
- `fix` 是一句话可复用修复。
- tags 带通用词和同义词。
- 已查重：与「空 partial 清空文案」不同根因，未合并。
- 已脱敏。
