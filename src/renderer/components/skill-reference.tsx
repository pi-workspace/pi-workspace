import { X } from 'lucide-react'
import type { SessionSkillReference } from '@/src/session-skills'

type SkillReferenceProperties = Readonly<{
  skill: SessionSkillReference
  onRemove?: () => void
}>

export function SkillReference({ skill, onRemove }: SkillReferenceProperties) {
  const description = skill.availability === 'available' ? skill.description : 'This Skill is no longer available.'
  return (
    <span
      className="group/skill inline-flex max-w-full cursor-default items-center align-baseline"
      contentEditable={false}
      data-skill-reference={skill.name}
    >
      <span
        className="truncate border-b border-skill-reference-underline font-medium text-skill-reference-foreground"
        title={description}
      >
        {skill.name}
      </span>
      {onRemove ? (
        <span className="grid max-w-0 grid-cols-[1.25rem] overflow-hidden opacity-0 transition-[max-width,opacity] duration-150 motion-reduce:transition-none group-hover/skill:max-w-5 group-hover/skill:opacity-100 group-focus-within/skill:max-w-5 group-focus-within/skill:opacity-100">
          <button
            type="button"
            aria-label={`Remove ${skill.name} Skill`}
            className="ml-0.5 flex size-5 items-center justify-center rounded-sm text-composer-muted-foreground outline-none hover:bg-composer-interaction hover:text-skill-reference-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
            onClick={onRemove}
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </span>
      ) : null}
    </span>
  )
}
