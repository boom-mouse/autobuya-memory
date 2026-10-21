---
date: 2026-10-21
area: functional
project: "Beatsketch"
platform: ios
status: fixed
title: 打开 AI 没有同意弹窗
symptom: 打开 AI 功能或拨开云端开关时没有同意弹窗，开关直接变成已同意
fix: 父页面已经是 sheet 时用同层覆盖展示同意页，不要再 present 第二张 sheet；开关打开时先展示同意页，点允许后再 grant
error_signatures:
  - "sheet(isPresented:)"
  - "onAppear"
  - "showConsent"
  - "setCloudComposeEnabled"
tags:
  - 同意
  - 弹窗
  - AI
  - sheet
  - 嵌套
  - consent
  - 开关
---

## 背景

iOS SwiftUI 应用在发送云端 AI 请求前需要用户同意数据共享。同意页 `AIConsentSheet` 挂在 Compose 视图的 `.sheet` 上，而 Compose 自己又是 Library / Studio 上的一张 `.sheet`。设置页的 “Allow cloud compose” 开关直接调用 `grant()`。

## 现象

1. 用户从 New Sketch 进入 Compose，或在设置里打开 AI 开关。
2. 看不到同意说明，也没有 Open gate / Keep gate shut。
3. 设置开关会立刻处于打开状态，之后再进 Compose 因为已经 `isAuthorized` 也不再提示。
4. 没有闪退，也没有导航 path 崩溃日志。

## 定位

两条路径都把「展示同意」跳过了，根因不是同意状态存盘失败：

- Compose 已经在 sheet 里。`onAppear` 里把 `showConsent = true` 再 `.sheet` 第二张同意页。SwiftUI 不会在一张 sheet 刚出现时再 present 嵌套 sheet，状态虽然变了，用户看不到弹窗。
- 设置开关的 `Binding.set(true)` 直接 `setCloudComposeEnabled(true)` → `consent.grant()`，根本没有挂同意页。

同意后闪退、`AnyNavigationPath.Error.comparisonTypeMismatch` 是另一条根因，见 `cases/2026-10-19-swiftui-shared-navigationpath-consent-crash.md`。本案例是弹窗没出现，不是崩溃。

## 修复

1. Compose 里把同意页从嵌套 `.sheet` 改成当前页面上的 `.overlay`，未授权时在 `onAppear` 盖住 Compose，点允许后再 `grant()`。
2. 设置开关拨到打开时只把 `showCloudConsent = true`，用设置页自己的 `.sheet` 展示同一张同意页；点允许才 `grant()`，点拒绝或关掉则保持未授权。关闭开关仍直接 `revoke()`。

## 适用边界

适用：

- 云端 AI / 数据共享同意页挂在已经 present 的 sheet、fullScreenCover 里面，并在 `onAppear` 里再弹一张 sheet。
- 设置开关、Toggle 在用户看到说明之前就写入 granted。

不适用：

- 同意页能出现，但点同意后导航崩溃（用共享 NavigationPath 案例）。
- 同意页被裁切、按钮在折痕下（那是 detent / safe area 布局问题）。
- 系统权限弹窗（麦克风、相册、相机）没出现。

## 复盘（可迁移的规则）

已经在 sheet 里的页面不要再 present 同意 sheet，尤其不要在 `onAppear` 里弹。用同层覆盖，或把唯一的同意 sheet 挂到还没 present 的父级。任何开关都不要在披露页出现之前 `grant()`。

## 提交前检查

- 根因已定位，不是猜测。
- 标题或 symptom 能用 2 字通用中文词搜到（同意、弹窗）。
- `fix` 是一句话可复用修复。
- tags 带通用词和同义词。
- 已查重：与「同意后 NavigationPath 崩溃」不同根因，未合并。
- 已脱敏。
