---
date: 2026-10-18
area: functional
project: "Mosaica"
platform: ios
status: fixed
title: 语音转文字空中间结果清空已有输入
symptom: 点击麦克风开始语音转文字后，输入框里原有文字立刻消失
fix: 开录前记住 seedNote；忽略空 partial；无有效 transcript 时恢复原文，禁止用空识别结果覆盖输入框
error_signatures:
  - "SFSpeechAudioBufferRecognitionRequest"
  - "shouldReportPartialResults"
  - "bestTranscription.formattedString"
tags: [麦克风, 语音转文字, 听写, 输入框, 文字消失, 清空, dictation, speech]
---

## 背景

iOS 产品在 Compose / 备注类页面提供「Speak the mood」一类本机听写：`SFSpeechRecognizer` + `AVAudioEngine`，`requiresOnDeviceRecognition = true`，`shouldReportPartialResults = true`。识别结果通过回调写回绑定到 `store.instruction`（或同类）的 TextField。

## 现象

1. 用户先在输入框打字，或点选 mood tile 追加文案。
2. 点击麦克风开始录制。
3. 输入框里原有文字立刻被清空（或变成空白），像被「抹掉」一样。
4. 即使用户还没开口、或识别失败/取消，原文也可能回不来。

## 定位

根因不是权限弹窗本身，而是**识别结果回写策略**：

- 识别回调里对 `result?.bestTranscription.formattedString` 做 `if let text` 后直接 `onText(text)`。
- 空字符串 `""` 在 Swift 里不是 `nil`，因此空的 partial / 取消瞬间仍会触发写回。
- 即便 `toggle` 用「`base + spoken`」拼接，只要 `base` 捕获时机不对，或取消路径再次用空 spoken 覆盖，已有文案仍会被清掉。
- `task?.cancel()` / `stop()` 结束时常见「有 error、无有效 transcript」；若此时仍把空结果写进绑定字段，用户感知就是「一点录制字就没了」。

## 修复

在听写控制器（如 `VoiceMoodRecorder`）统一约束：

1. **开录前**把当前文案存成 `seedNote`（trim 后）。
2. **publish** 时：spoken 为空 → 只回写 `seedNote`；有 spoken → `seedNote` 为空则用 spoken，否则 `"\(seedNote), \(spoken)"`。
3. **忽略空 partial**：`formattedString` 为空或全空白时不更新 transcript、不覆盖输入框。
4. **stop / 取消**：若全程没有有效 transcript，显式 `publish(spoken: "")` 以恢复 `seedNote`，禁止留下空白字段。

## 适用边界

适用：

- iOS `SFSpeechRecognizer` + partial results 回写 TextField / `@Observable` 绑定字段。
- 「在已有文案上追加口述」的产品交互（备注、风格说明、搜索框听写等）。

不适用：

- 明确要求「开始听写即清空并只保留口述」的交互。
- 非 Speech 框架的第三方 ASR，或服务端流式结果（需按各自空帧语义单独处理，原则相同：空帧勿覆盖原文）。

## 复盘（可迁移的规则）

**空识别结果不是合法更新。** 凡把 ASR partial/final 写回可编辑文本，必须：开录前快照原文、忽略空白帧、取消/失败时恢复快照；不要把 `Optional` 非 nil 的空字符串当成「用户说了空话」去覆盖输入框。

## 提交前检查

- 根因已定位，不是猜测。
- 标题或 symptom 能用 2 字通用中文词搜到（麦克风 / 语音 / 清空）。
- `fix` 是一句话可复用修复。
- tags 带通用词和同义词。
- 已查重，同根因案例已合并（检索 0 命中后新建）。
- 已脱敏。
