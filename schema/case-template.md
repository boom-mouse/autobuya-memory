---
date: YYYY-MM-DD
area: layout        # layout | functional | iap | privacy | build | dispatch | review | tooling | other
project: ""         # 包名 / 产品名，可空
platform: ios       # ios | flutter | macos | tooling
status: open        # open | fixed | rule-promoted
title: 场景+现象+对象的一句话标题
symptom: ""         # 一句话症状（审查/用户可见的表现）
fix: ""             # 一句话修复（有则填，供「同问题→修复」检索展示）
error_signatures: []   # 原文错误串、错误码、日志片段
tags: []               # 通用词+同义词，如 深色模式、弹窗、黑屏、主题色
---

## 背景

## 现象

## 定位

## 修复

## 适用边界

## 复盘（可迁移的规则）

## 提交前检查

- 根因已定位，不是猜测。
- 标题或 symptom 能用 2 字通用中文词搜到。
- `fix` 是一句话可复用修复。
- tags 带通用词和同义词。
- 已查重，同根因已合并。
- 已脱敏。

完整门槛见 `schema/acceptance.md`。
