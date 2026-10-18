---
date: 2026-10-18
area: layout
project: "Fieldplate"
platform: ios
status: fixed
title: SwiftUI scaledToFill 只限高把整页横向撑开
symptom: 有图页面左右边缘文字和按钮同时被切掉，整页比屏幕更宽
fix: 槽位先从容器拿宽再限高；scaledToFill 只放在 Color.clear overlay 里再 clipped，禁止用图片理想宽高比报宽
error_signatures:
  - "scaledToFill()"
  - ".frame(height:"
  - "swiftui_fill_image_height_only_frame"
  - "layout_source_scan"
tags: [横向溢出, 撑宽, 切边, 图片, scaledToFill, ScrollView, contained, overflow, image]
---

## 背景

SwiftUI 拍照 / 预览 / 详情一类页面常把媒体放进纵向 `ScrollView`，用 `Image.resizable().scaledToFill()` 铺满一个限高台面。布局验收里 `layout_source_scan` 专门扫「fill 图 + 只限高」写法；`contained` 条文也点名：外层 `.frame(maxWidth: .infinity)` **收不回**图片按高×宽高比报出的宽度。

## 现象

1. 空态或占位图时页面看似正常。
2. 放入横向更宽的实图（相册、样张、冲印预览）后，**整页变宽于屏幕**。
3. 用户可见：左右两侧同时被切——顶栏文案缺字、台面按钮缺半边、底栏控件贴边截断；不是单一控件换行问题。
4. 导航栏等系统 chrome 仍可能对齐屏幕，只有 `ScrollView` 内容区横向溢出。

## 定位

根因是 **布局尺寸由 fill 图的理想宽高比决定，而不是由列宽决定**：

- 容器只有 `.frame(height: H)`（或子图 `.frame(maxWidth: .infinity, maxHeight: .infinity)` 挂在只限高的父级上）。
- `scaledToFill()` 在拿到高度后，报宽 = 高度 × 原图宽高比；宽图把列、再把纵向 `ScrollView` 内容宽度撑出视口。
- `.clipped()` / 圆角 / `maxWidth: .infinity` 只改绘制或意图，**不改变向上报告的占位宽度**。
- 帧若只截空态，读图看不到；必须以有图分支在源码里按最小视口核算，或跑 `layout_source_scan`（rule: `swiftui_fill_image_height_only_frame`）。

## 修复

1. 台面 / 媒体槽：**先** `.frame(maxWidth: .infinity)`，**再** `.frame(height: H)`，宽度来自列。
2. 图片不要直接作为报宽子视图；用透明槽 + overlay：

```swift
Color.clear
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .overlay {
        Image(uiImage: image)
            .resizable()
            .scaledToFill()
    }
    .clipped()
```

3. 复验：`layout_source_scan` 对该文件 0 hit；有图态下左右边距对称、整页宽度等于屏宽。

## 适用边界

适用：

- SwiftUI `Image` / `AsyncImage` + `scaledToFill()`（或 `aspectRatio(..., contentMode: .fill)`）放在纵向滚动页或限高卡片里。
- 布局验收 `contained` / `dynamic_media_containment`；机器扫描 `swiftui_fill_image_height_only_frame`。

不适用：

- 已声明且真正局部横滚的 `ScrollView(.horizontal)` 露边 peek（需 `scroll_axes: horizontal_local`）。
- 仅文字 `fixedSize(horizontal: true)` / `ViewThatFits` 撑宽（同类症状、另一根因，另案）。
- Flutter / UIKit 需各自对「fill + 只限高」做等价约束，原则相同：占位宽来自父级，fill 只影响绘制。

## 复盘（可迁移的规则）

**Fill 图的占位宽必须来自容器，不能来自原图宽高比。** 纵向滚动里凡 `scaledToFill`，先锁列宽再限高，图画在 overlay 里再 clip；不要相信「已经写了 maxWidth: .infinity」就能防止整页横向溢出。空态帧通过不等于有图分支安全——源码核算或 `layout_source_scan` 必跑。

## 提交前检查

- 根因已定位，不是猜测。
- 标题或 symptom 能用 2 字通用中文词搜到（溢出 / 撑宽 / 图片）。
- `fix` 是一句话可复用修复。
- tags 带通用词和同义词。
- 已查重，同根因案例已合并（scaledToFill / 图片撑宽检索 0 命中后新建）。
- 已脱敏。
