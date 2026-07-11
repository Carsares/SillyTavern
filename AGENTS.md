# 仓库改动约束

当前仓库严格限制改动位置，所有代码改动只能直接发生在 `master` 分支上。

1. 禁止新建、切换或拉取任何非 `master` 分支进行改动（包括 `git checkout -b`、`git switch -c`、`git branch` 等）。
2. 禁止新建、切换、删除或清理 worktree（包括 `git worktree add/remove/prune`，以及通过 gitepic、rqws 等工具间接创建或切换 worktree）。
3. 只允许在当前 `master` 分支、当前工作区内直接修改、验证与提交。
4. 如确需偏离以上约束，必须先停下来向用户说明原因并取得明确授权，禁止自作主张新建分支或 worktree。
