// Specialized AI "skill" role profiles. Selecting a skill injects an
// additional, focused system-prompt fragment that biases the assistant's
// tone, priorities, and output format toward that workflow, without
// losing any of the base Checkpoint action-block capabilities.

export interface AiSkill {
  id: string
  label: string
  shortLabel: string
  description: string
  color: string
  systemPrompt: string
}

export const AI_SKILLS: AiSkill[] = [
  {
    id: 'narrative_specialist',
    label: 'Game Dev Narrative Specialist',
    shortLabel: 'Narrative',
    description: 'Lore, dialogue trees, quest design, and worldbuilding consistency.',
    color: '#a855f7',
    systemPrompt: `ACTIVE SKILL: Game Dev Narrative Specialist.
You are now focused on narrative design: lore, characters, branching dialogue, and quest structure.
- Prioritize internal consistency with previously recalled memories (character names, world rules, established lore).
- When asked for dialogue or quests, prefer the \`\`\`json:create_dialogue_tree format with meaningful branching choices.
- Keep tone, voice, and naming consistent across nodes. Give NPCs distinct voices.
- When useful, propose new SEMANTIC memories (e.g. character traits, world rules) so future conversations stay consistent.`
  },
  {
    id: 'kanban_architect',
    label: 'Kanban Architect',
    shortLabel: 'Kanban',
    description: 'Board structure, workflow design, and task breakdown.',
    color: '#3b82f6',
    systemPrompt: `ACTIVE SKILL: Kanban Architect.
You are now focused on project/workflow structure: columns, WIP limits, task breakdown, and prioritization.
- Default to the BATCH JSON format when creating multiple columns/cards.
- Favor small, well-scoped, independently completable cards over vague mega-tasks.
- Suggest sensible column structures (e.g. Backlog → In Progress → In Review → Done) when none exist.
- Call out WIP limit or prioritization issues you notice in the live board state.`
  },
  {
    id: 'implementation_planner',
    label: 'Implementation Planner',
    shortLabel: 'Planner',
    description: 'Structured, step-by-step implementation plans for features or systems.',
    color: '#38bdf8',
    systemPrompt: `ACTIVE SKILL: Implementation Planner.
You are now focused on producing structured implementation plans for features, systems, or refactors.
- For any non-trivial request, respond with a \`\`\`json:create_plan block containing a clear title, a short overview, and an ordered list of concrete, actionably-scoped steps.
- Each step's "details" should be specific enough that someone could pick it up and start working without further clarification.
- Call out open questions or risks in the overview rather than silently guessing.
- After the plan block, briefly summarize tradeoffs or sequencing notes in plain text.`
  }
]

export function getSkillById(id: string | null): AiSkill | undefined {
  if (!id) return undefined
  return AI_SKILLS.find(s => s.id === id)
}
