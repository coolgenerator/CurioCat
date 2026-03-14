中文 | [**English**](./README.md)

<p align="center">
  <img src="frontend/public/CurioCat-Logo.png" alt="CurioCat" width="120" />
</p>

<h1 align="center">CurioCat</h1>

<p align="center">
  <em>"Curiosity killed the cat, but satisfaction brought it back."</em><br/>
  <em>好奇误猫命，知足猫复生。</em>
</p>

<p align="center"><strong>因果推理驱动的智能决策引擎 — 在海量信息中，让每一次决策有理有据。</strong></p>

---

CurioCat 是一款 AI 驱动的决策智能工具，让因果推理看得见、用得上。输入任意非结构化文本 — 政策简报、创业计划书、新闻事件、战略假设 — 系统会将信息拆解为原子化主张，追踪隐藏的因果链条，用真实世界的证据锚定每一条因果关系，最终呈现为一张可交互、可探索的因果图谱。

不再依赖黑箱预测。你能清晰看到一件事*为什么*导致另一件事、证据*有多强*、假设改变后*会怎样*。推理链上的每一环都透明可调、有据可查 — 将信息过载转化为结构化洞察，辅助更好的决策。

## 截图

![主界面](static/screenshot/curiocat_zh_main.png)
![因果图谱](static/screenshot/curiocat_zh_graph_basic.png)
![聚焦模式](static/screenshot/curiocat_zh_graph_focus.png)

## 工作原理

CurioCat 通过多层流水线，将非结构化文本转化为可交互的因果决策图：

**初始分析** — 从用户输入中提取命题，构建种子图谱：

1. **主张拆解** — LLM 提取原子化主张（事实 / 假设 / 预测 / 观点），附带置信度评分和原文溯源，支持审计追踪
2. **因果推断** — 先用嵌入向量相似度筛选候选对，再由 LLM 判定因果方向、机制和强度。LLM 输出后经过验证门控：拒绝空洞机制描述、重复原文、极端强度值的边
3. **偏见审查** — 检测 8 种认知偏见，自动降低对应因果链的强度
4. **证据锚定** — 通过 Brave Search 进行对抗式双向搜索（正面 + 反面证据），按相关性、来源可信度和跨域多样性评分

**发现轮次** — 迭代扩展图谱，补充原始文本未提及的事实：

5. **事实发现** — LLM 从已搜集的证据片段中提取原文没有的新命题。新命题经过语义去重（0.95 余弦相似度阈值）和网络验证后才能进入图谱
6. **增量推断 + 审查 + 锚定** — 仅检查涉及新命题的配对（不重复检查旧↔旧的组合）。新边同样经过偏见审查和证据搜索

发现轮次会重复执行（默认最多 3 轮），直到收敛：新命题少于 2 条且新边少于 1 条，或轮次预算耗尽。

**最终阶段：**

7. **构建因果图** — 生成有向无环图，含环路检测/断环和弱边剪枝
8. **置信传播** — Noisy-OR 算法沿拓扑排序传播置信度，受证据质量调节。通过扰动分析计算不确定性区间

## 反幻觉流水线

CurioCat 针对常见 LLM 幻觉路径构建了多层验证体系：

| 层级 | 功能 |
|------|------|
| **输出验证门控** | 拒绝机制描述空洞/重复原文、因果强度极端的边 — 防止 LLM 虚构的假因果关系进入图谱 |
| **证据调制** | 零证据的边贡献零置信度（而非 50%）— 无证据支撑的主张无法在图谱中传播 |
| **偏见严重性惩罚** | 检测 8 种认知偏见（相关≠因果、幸存者偏差、叙事谬误、锚定效应、反向因果、选择偏差、生态谬误、确认偏差），自动降低因果强度：轻度→5%、中度→20%、重度→40% |
| **来源多样性评分** | 单一来源域名的证据最多降权 30% — 防止过度依赖单一信源 |
| **发现验证** | 从证据片段中发现的新主张必须经过网络验证才能进入图谱 — 阻断循环推断 |
| **主张溯源** | 每条主张存储其提取自的原文句子 — 全链路审计追踪，可回溯至原始文本 |
| **置信区间** | 基于扰动分析的不确定性区间 — 直观展示每个节点的置信度对输入变化的敏感程度 |

## 架构

```
┌─────────────────────────────────────────────────────┐
│  前端 (React + D3.js + Tailwind)                     │
│  ┌─────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │  输入    │→│ 处理中   │→│  径向树可视化       │  │
│  │  界面    │  │  (SSE)   │  │  (D3 命令式渲染)   │  │
│  └─────────┘  └──────────┘  └────────────────────┘  │
│                               ┌──────┐ ┌──────────┐ │
│                               │情景  │ │  导出     │ │
│                               │推演  │ │  面板     │ │
│                               └──────┘ └──────────┘ │
└───────────────────┬─────────────────────────────────┘
                    │ REST / SSE / WebSocket
┌───────────────────┴─────────────────────────────────┐
│  后端 (FastAPI + SQLAlchemy)                         │
│  ┌──────────────────────────────────────────────┐   │
│  │  五阶段流水线调度器                            │   │
│  │  主张拆解 → 因果推断 →                         │   │
│  │  证据锚定 → 构建因果图 →                       │   │
│  │  置信传播                                     │   │
│  └──────────────────────────────────────────────┘   │
│  ┌─────────┐  ┌───────────┐  ┌─────────────────┐   │
│  │ LLM     │  │  图算法    │  │  证据搜索/评分   │   │
│  │ 客户端  │  │           │  │                 │   │
│  └─────────┘  └───────────┘  └─────────────────┘   │
└───────────────────┬─────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │  PostgreSQL + pgvector │
        └───────────────────────┘
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19, TypeScript, D3.js v7, Tailwind CSS 4, Framer Motion |
| 后端 | FastAPI, SQLAlchemy 2.0 (异步), Pydantic v2 |
| 数据库 | PostgreSQL 16 + pgvector |
| 大模型 | OpenAI / Anthropic（可切换） |
| 搜索 | Brave Search API |
| 图算法 | NetworkX, Noisy-OR 置信传播 |
| 基础设施 | Docker Compose, Alembic 数据库迁移 |
| 实时通信 | Server-Sent Events, WebSocket |

## 快速开始

### 前置要求

- Docker & Docker Compose
- Node.js 20+
- Python 3.12+（推荐使用 [uv](https://docs.astral.sh/uv/)，pip 也可以）

### 1. 克隆并配置环境变量

```bash
cd CurioCat
cp .env.example .env
```

编辑 `.env`，填入必要的配置：

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | 是 | PostgreSQL 连接字符串。使用自带 Docker 容器的话保持默认值即可：`postgresql+asyncpg://curiocat:curiocat@localhost:5432/curiocat` |
| `OPENAI_API_KEY` | 是* | OpenAI API 密钥（`sk-...`）。`LLM_PROVIDER=openai`（默认）时必填 |
| `ANTHROPIC_API_KEY` | 是* | Anthropic API 密钥（`sk-ant-...`）。`LLM_PROVIDER=anthropic` 时必填 |
| `BRAVE_SEARCH_API_KEY` | 是 | Brave Search API 密钥，用于证据搜索。可在 [brave.com/search/api](https://brave.com/search/api/) 免费申请 |
| `LLM_PROVIDER` | 否 | `openai`（默认）或 `anthropic` |
| `LLM_MODEL` | 否 | 模型名称，默认 `gpt-4o` |
| `EMBEDDING_MODEL` | 否 | 嵌入模型，默认 `text-embedding-3-small` |
| `SERVER_HOST` | 否 | 默认 `0.0.0.0` |
| `SERVER_PORT` | 否 | 默认 `8000` |
| `CORS_ORIGINS` | 否 | 允许的跨域来源（JSON 数组），默认 `["http://localhost:5173"]` |

> \* `OPENAI_API_KEY` 和 `ANTHROPIC_API_KEY` 至少填一个，取决于你选择的 LLM 供应商。

### 2. 启动数据库

CurioCat 使用 PostgreSQL 16 + [pgvector](https://github.com/pgvector/pgvector) 扩展。最简单的方式是用 Docker：

```bash
docker compose up -d postgres
```

这会启动一个 `pgvector/pgvector:pg16` 容器，监听 5432 端口，带自动健康检查。数据持久化在 Docker 卷（`pgdata`）中。

> **已有 PostgreSQL？** 安装 `pgvector` 扩展，创建 `curiocat` 数据库，然后在 `.env` 中修改 `DATABASE_URL` 即可。

### 3. 启动后端

```bash
# 创建虚拟环境并安装依赖
# 方式 A — uv（推荐，更快）：
uv sync

# 方式 B — pip：
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# 运行数据库迁移
alembic upgrade head

# 启动后端服务（http://localhost:8000）
uvicorn curiocat.main:app --reload
```

### 4. 启动前端

另开一个终端：

```bash
cd frontend
npm install
npm run dev
```

打开 [http://localhost:5173](http://localhost:5173)。

Vite 开发服务器会自动将 `/api/*` 和 `/ws/*` 请求代理到后端，前端无需额外配置。

### 5. 导入示例数据（可选）

项目自带一份预构建的中文示例（"AI 取代程序员？因果链推演"），无需消耗 API token 即可直接体验完整的因果图谱：

```bash
psql postgresql://curiocat:curiocat@localhost:5432/curiocat -f seed_ai_replace_programmers_zh.sql
```

这会导入 77 条主张、1,717 条因果边和 1,485 条证据记录。导入后访问 [http://localhost:5173/history](http://localhost:5173/history)，点击项目即可探索。

> 英文版种子数据也可用：`seed_ai_replace_programmers.sql`

### 替代方案：Docker Compose 一键启动

用 Docker 同时运行数据库和后端：

```bash
docker compose up --build
```

这会启动 PostgreSQL + 后端 API。前端仍需单独运行 `npm run dev`（见步骤 4）。

## 使用方式

1. **输入文本** — 粘贴一段场景描述、文章或假设（也可选择内置示例）
2. **实时分析** — 引擎逐步拆解并追踪因果链，主张实时流式呈现
3. **探索因果图** — 可缩放的交互式径向树，点击展开/折叠节点
4. **审查证据** — 点击因果边查看正反两面证据及来源链接
5. **压力测试假设** — 右键调整因果强度，置信度实时重新传播
6. **情景推演** — 创建"如果……会怎样"分支，并排或叠加对比
7. **导出决策报告** — 下载为 JSON、Markdown 报告或可交互 HTML

## 项目结构

```
curiocat/
├── api/
│   ├── models/          # 请求/响应模型（analysis、graph、scenarios）
│   └── routes/          # 分析、图谱、情景、导出、操作
├── db/                  # SQLAlchemy 模型与数据库会话
├── evidence/            # Brave Search 客户端、来源可信度评分
├── graph/               # 置信传播、敏感度分析、关键路径、情景对比、焦点、路径查找
├── llm/
│   ├── prompts/         # 结构化提示词（主张提取、因果推断、证据搜索、偏见检测、发现、战略顾问）
│   ├── client.py        # LLM 客户端抽象层（OpenAI/Anthropic）
│   └── embeddings.py    # 嵌入向量生成
├── pipeline/            # 调度器 + 各阶段：拆解 → 推断 → 锚定 → 构建 → 传播，偏见审计，发现
├── config.py            # Pydantic Settings 配置
├── exceptions.py        # 自定义异常类
└── main.py              # FastAPI 应用入口

frontend/src/
├── components/
│   ├── input/           # InputScreen、DemoScenarios
│   ├── processing/      # ProcessingScreen、PipelineStream、ClaimStream、EdgeStream、EvidenceStream、StageTimeline
│   ├── tree/            # ForceGraph、GraphScreen、GraphListScreen、EvidencePanel、NodeDetailPanel、EdgeBundlePanel、
│   │                    # ClaimsBrowser、MiniMap、GraphTooltip、StrategicAdvisorPanel、TimelineView、TimeScrubber
│   ├── scenario/        # ScenarioForge、ComparisonView、MergeOverlay
│   ├── export/          # ExportPanel
│   ├── layout/          # AppLayout
│   └── ui/              # Button、Card、Badge、Slider、Progress、Textarea、Tooltip、LoadingSpinner、ResizablePanel、ErrorBoundary
├── context/             # AnalysisContext（useReducer 状态管理）
├── hooks/               # useForceLayout、useSSEStream、useGraphWebSocket、useGraphOperations、
│                        # useKeyboardNavigation、useResizablePanel、useScenario、useTemporalBeliefs、useTheme
├── i18n/                # 国际化（中文、英文）
├── lib/
│   ├── api/             # HTTP 客户端、SSE 辅助、WebSocket 辅助
│   ├── graphUtils.ts    # 图谱布局工具
│   └── visualConstants.ts
└── types/               # TypeScript 类型定义（api、graph）
```

## 许可证

MIT
