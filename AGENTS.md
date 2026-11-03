<!-- ai-collab:start -->
# Automatic model routing (ai-collab)

For normal project requests use the installed `ai-collab` skill
(`~/.claude/skills/ai-collab/SKILL.md`, Codex: `~/.codex/skills/ai-collab/SKILL.md`) and run its
`router.py --root <this project> dispatch --request-file <UTF-8 file under .orca-routing/>`
before implementation. `.orca-routing/runtime.json` (local, git-ignored) holds executable paths;
recreate it with `ai-workspace/setup/enable-project.ps1 -Project <this project>`.

A prompt marked `[ORCA_ROUTED:...]`, an Orca Task/Dispatch preamble, or a trivial question the
coordinator can answer directly is already assigned: do not route it again.
If a worker hits a usage limit, use the skill's `failover` (Claude <-> Codex) instead of stopping.
Project rules elsewhere in this file still apply to the executing agent.
<!-- ai-collab:end -->
