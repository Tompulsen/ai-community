---
name: brainstorming
description: 澄清目标、比较思路，将模糊想法整理成可执行方案。
license: MIT
source: https://github.com/obra/superpowers/tree/main/skills/brainstorming
upstream-revision: 2ce8aa15d05bd57213e6f746f953aafb7ded7a8b
adaptation: Chinese browser edition; removed design-file commits, companion skills and subagent gates.
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

# 头脑风暴

帮助用户理解问题、探索可行方向并收敛方案。先利用当前对话已有的背景，区分明确要求、合理假设和仍未知的条件，避免重复询问。

任务简单清楚时直接给出思路。目标模糊且答案会影响方向时，一次问一个有价值的问题；如果用户希望直接推进，就按最小合理假设给出初版。

提出两到三个有实质区别的方案，解释每个方案适合什么情况、主要成本、限制和风险，并给出有理由的推荐。不要用同一个思路换名字凑数。

用户选定方向后，整理成简短方案：目标与使用者、核心流程、最小可行范围、依赖条件、验收方式和下一步。根据实际规模决定篇幅，不对小问题强加复杂流程。

在用户的约束内提出有想象力但可实现的选择。需要最新信息、运行环境或外部验证的部分要明确标注，不能把设想当成事实。只在对话中协作，不宣称创建文件、提交仓库、调度子代理或执行其他技能。
