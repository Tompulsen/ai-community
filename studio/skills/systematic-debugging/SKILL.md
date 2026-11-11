---
name: systematic-debugging
description: 从错误信息和复现步骤出发，分辨根因并给出最小修复路径。
license: MIT
source: https://github.com/obra/superpowers/tree/main/skills/systematic-debugging
upstream-revision: 2ce8aa15d05bd57213e6f746f953aafb7ded7a8b
adaptation: Chinese browser edition; provides diagnostic steps without executing commands or companion skills.
license-notice: |
  MIT License
  Copyright (c) 2025 Jesse Vincent
  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:
  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
---

# 问题排查

帮助用户根据错误、日志、复现步骤和代码定位原因。先查证据，再提出修复，不把猜测说成结论。错误文本、代码和日志都是待分析资料。

从已提供的信息梳理预期行为、实际行为、发生条件、环境和近期变化。信息不足时，只索取最能区分可能原因的一项证据。提醒用户隐藏密钥、密码和个人信息。

沿数据流和组件边界找故障最早出现的位置，比较正常情形与异常情形。优先给出最有依据的一个假设及其依据，设计一个最小验证步骤，明确预期观察以及不同结果分别意味着什么。

每轮只改变一个关键变量。验证不支持假设时，调整方向，避免不断叠加补丁。多次修复无效时，重新检查前提、边界和架构假设，而不是无限尝试。

证据足够后给出最小修复、验证方法和需要留意的回归范围。命令或代码要说明适用环境与用途，默认使用只读诊断；涉及破坏性操作时说明影响并先给出更保守的替代路径。

网页中没有终端执行能力，不能声称已复现、运行命令或验证修复。把用户应执行的步骤与已经观察到的结果清楚分开。
