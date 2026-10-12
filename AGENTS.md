# AIRI workspace workflow

This workspace contains the upstream `airi/` repository, local development scripts,
Chinese architecture documents in `开发文档/`, and task data in `项目管理/`.
Read `airi/AGENTS.md` and applicable nested rules before changing source code.

For every project change:

1. Read the task board and current changes. Add or update a task in the local
   project manager at http://127.0.0.1:5174. Start it with
   `scripts/start-project-manager.ps1` if needed. Do not replace existing tasks.
2. Keep guest entry working. An unauthenticated user is called 陌生人 in Chinese.
   Do not invent accounts, tokens, paid credits, or bypass hosted server checks.
3. Update `开发文档/01-system-architecture.md` when modules, interfaces, or data
   flows change. Update `04-development-guide.md` and `05-project-management.md`
   when their instructions change. Mechanical indexes do not replace analysis.
4. Run required checks. Rebuild `@proj-airi/i18n` after locale source changes.
   Run `scripts/test-airi-delivery.ps1 -Task <task-id>` for application changes;
   it retains the voice, identity, archive, session, capture and runtime regression baseline.
   A failed gate blocks a regression-passed claim. Also verify the running stage's
   start/close/restart and settings/memory navigation, and record unavailable device
   or model tests explicitly. See `开发文档/04-development-guide.md`.
5. Run `scripts/generate-project-index.mjs` through the Node runtime initialized
   by `scripts/airi-env.ps1`, or use the manager's sync action.
6. Record the change and validation result on the task before reporting completion.
   Distinguish completed work from unconfigured model services or untested features.

Use existing local scripts and dependencies. Do not add external project accounts
or paid services without a user request. Never put API keys in task records,
architecture documents, screenshots, or version control.

## 报告语言

本项目以后新增或修改的交付报告、验证报告和调查报告必须使用中文。
技术名称、代码、命令、文件路径及原始错误保留原文，必要时补中文解释。
用户的中文报告要求优先于上游 simple-english 的语言要求，仍须表达清楚、保留真实证据与未验收边界。

## Project memory and questions

Read `wiki/README.md` first for project work or questions about this project.
Use its routing table or `scripts/project-wiki.mjs find` to select relevant topics.
Read only the needed topic, then its source evidence and applicable rules.
If evidence is stale, inspect the changed source before using the conclusion.
Update affected topics and record reusable decisions or lessons during development.
After manual review, record the topic fingerprint with `project-wiki.mjs review`.
Run `project-wiki.mjs check` before completion and record results on the task.
Keep project knowledge separate from runtime personal memories and model training.
