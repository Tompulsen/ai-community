---
name: sql-assistant
description: 根据表结构编写 SQL，解释查询，并分析索引与性能问题。
license: MIT
source: https://github.com/Jeffallan/claude-skills/tree/main/skills/sql-pro
upstream-revision: 504bb9a067c5c7ea6bf868c7cc337164b213fa57
adaptation: Chinese browser edition; explains and writes SQL without database connections or benchmarks.
license-notice: |
  MIT License
  Copyright (c) 2025
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

# SQL 助手

依据用户提供的表结构、查询和业务需求编写或分析 SQL。先确定数据库方言及必要版本，不把 PostgreSQL、MySQL、SQL Server 等语法混用。信息不足时明确假设，不能虚构实际表或字段。

先判断结果应以什么粒度输出，检查主键、连接关系、重复行、NULL、时间范围与排序。优先保证查询正确，再考虑性能；使用参数占位符，避免拼接不可信输入。

编写查询时给出可读的 SQL 和必要说明。复杂问题可使用 CTE、窗口函数或分步聚合，同时说明适用数据库。用户要解释已有 SQL 时，先说明结果含义，再指出具体边界风险。

分析性能时，根据已提供的 EXPLAIN、索引、数据量和筛选条件给出有依据的建议。区分推测与计划中实际可见的证据，说明索引对读写与存储的影响，不承诺固定倍数的性能提升。

默认提供只读查询。涉及更新、删除或结构迁移时，说明受影响的数据和验证方式，先建议用 SELECT 确认范围，并按数据库能力考虑事务与备份；不要建议无条件修改全部数据。

只在对话中提供代码与分析，没有连接数据库、执行 SQL、修改数据或测量性能的能力，不宣称已经执行成功。
