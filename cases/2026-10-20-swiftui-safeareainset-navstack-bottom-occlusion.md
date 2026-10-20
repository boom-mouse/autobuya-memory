---
date: 2026-10-20
area: layout
project: "Sumiflow"
platform: ios
status: fixed
title: SwiftUI 自定义底栏 safeAreaInset 被 NavigationStack 吃掉导致底部遮挡
symptom: 页面底部按钮和文案被自定义 Tab 栏盖住，无法点击
fix: NavigationStack 内 GeometryReader 用 safeAreaInsets.bottom 判断：inset 生效只留短 gap，未上报则预留底栏高度
error_signatures:
  - "safeAreaInset(edge: .bottom"
  - "NavigationStack"
  - "GeometryReader"
  - "bottomClearance"
  - ".toolbar(.hidden, for: .tabBar)"
tags: [遮挡, 重叠, 底部, 导航栏, TabBar, safeAreaInset, NavigationStack, GeometryReader, 安全区, occlusion]
---

## 背景

隐藏系统 `TabBar`、在根视图用 `safeAreaInset(edge: .bottom)` 挂自定义底栏（如“笔搁 / Brush rest”）是常见 SwiftUI 壳。子页再包一层 `NavigationStack`，并用 `GeometryReader` 做满屏分栏时，父级 inset 经常**进不了**子几何的 `safeAreaInsets`，内容仍按全屏高度排布。

## 现象

1. 自定义底栏（Studio / Flow / Settings 一类）浮在屏幕底部。
2. 当前页最底部的主操作（如 Generate、Coach）半截或整块压在底栏下面。
3. 卡片底边、下划线仍能透过半透明底栏看到，说明内容高度算到了底栏背后，不是缺内容。
4. 同 App 里若某页已手写底部留白，可能只有那一页正常，其它 `NavigationStack` 页仍遮挡。

## 定位

根因是 **父级 `safeAreaInset` 的占用高度没有可靠传到 `NavigationStack` 内的 `GeometryReader`**：

- 根：`TabView` + `.toolbar(.hidden, for: .tabBar)` + `.safeAreaInset(edge: .bottom) { CustomTabBar }`。
- 子页：`NavigationStack { GeometryReader { … .padding(.bottom, 6) } }`，按 `geo.size.height` 铺满。
- 在部分 iOS / 嵌套组合下，`proxy.safeAreaInsets.bottom` 仍只反映 Home Indicator，**不含**自定义底栏高度；于是 `sealRow`、侧栏底部按钮贴着几何底边，视觉上落在底栏下面。
- 与“忘记写 safeArea”不同：表面写了 `safeAreaInset`，但 Stack + GeometryReader 吃掉了上报。

## 修复

在每个受影响页的 `GeometryReader` 内，用与 Settings 同类的兜底：

```swift
private func bottomClearance(_ proxy: GeometryProxy) -> CGFloat {
    let reported = proxy.safeAreaInsets.bottom
    if reported >= 70 {
        return 12 // 或 20：inset 已够，只留短 gap
    }
    return 88 // 底栏自身高度量级
}

// 主列 / ScrollView 内容：
.padding(.bottom, bottomClearance(geo))
```

要点：

1. 阈值约等于自定义底栏视觉高度（含 `spacing`），以实测为准。
2. `reported >= 70` 表示 inset 已含底栏，避免双重留白。
3. 固定贴底的控件（非 ScrollView 尾部）也必须吃同一 clearance，不能只给滚动内容加 padding。

## 适用边界

适用：

- SwiftUI 隐藏系统 TabBar，根级 `safeAreaInset(edge: .bottom)` 自定义底栏。
- 子页为 `NavigationStack` + 满高 `GeometryReader` / 固定底栏操作区。
- 验收项里“底部主按钮可点、不被 chrome 盖住”。

不适用：

- 系统 `TabView` 默认 tabBar（未 hide）且内容已在系统安全区内。
- 仅键盘顶起、sheet / fullScreenCover 内遮挡（另一套 inset）。
- Flutter `SafeArea` / Android edge-to-edge：原则相近，但不能直接抄 `safeAreaInsets.bottom` 阈值。

## 复盘（可迁移的规则）

**根级 `safeAreaInset` 不等于子 `NavigationStack` 里的 Geometry 一定收到。** 凡自定义底栏 + Stack + 满高 GeometryReader，应用 `safeAreaInsets.bottom` 做阈值判断：够大只留 gap，不够则显式预留底栏高度；不要假设“已经写了 safeAreaInset 就不会挡按钮”。同 App 一页修好不等于其它 Tab 安全——每个 GeometryReader 页都要过一遍。

## 提交前检查

- 根因已定位，不是猜测。
- 标题或 symptom 能用 2 字通用中文词搜到（遮挡 / 重叠 / 底部）。
- `fix` 是一句话可复用修复。
- tags 带通用词和同义词。
- 已查重，同根因案例已合并（safeAreaInset / 遮挡 / 底部检索 0 命中后新建）。
- 已脱敏。
