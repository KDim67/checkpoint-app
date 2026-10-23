/** making a workspace, or changing one: its name, colour and repository, and on making one, what it starts from */

import React, { useEffect, useRef, useState } from 'react'
import ModalShell from '../ui/ModalShell'
import ColorPicker from '../ui/ColorPicker'
import { selectFolder } from '../../data/workspaceFolder'
import { slugifyWorkspace, WORKSPACE_COLORS } from '../../lib/createWorkspace'
import { DEFAULT_TEMPLATE_ID, describeTemplate, PROJECT_TEMPLATES } from '../../../../shared/projectTemplates'
import { errorMessage } from '../../../../shared/errors'
import type { Outcome, WorkspaceFields } from './useWorkspaces'
import WorkspaceTile from './WorkspaceTile'
import { ICON_TYPES, storeWorkspaceIcon } from '../../lib/workspaceIcon'

interface Props {
  mode: 'new' | 'edit'
  initial: { name: string; color: string; gitPath: string; slug?: string; icon?: string }
  /** the field the cursor starts in: Linked repository opens on the folder */
  focus?: 'name' | 'repo'
  onSubmit: (fields: WorkspaceFields) => Promise<Outcome>
  onClose: () => void
}

/** a row of choices where the arrows move and only the chosen one is a Tab stop, as a radio group does */
function moveChoice<T>(event: React.KeyboardEvent, options: T[], chosen: T, choose: (value: T) => void): void {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  event.preventDefault()
  const at = Math.max(0, options.indexOf(chosen))
  const next = options[(at + step + options.length) % options.length]
  choose(next)
  const group = event.currentTarget as HTMLElement
  requestAnimationFrame(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
}

export default function WorkspaceFormDialog({ mode, initial, focus = 'name', onSubmit, onClose }: Props): React.JSX.Element {
  const [name, setName] = useState(initial.name)
  const [color, setColor] = useState(initial.color)
  const [gitPath, setGitPath] = useState(initial.gitPath)
  const [slug, setSlug] = useState(initial.slug ?? '')
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID)
  const [icon, setIcon] = useState(initial.icon ?? '')
  const [iconState, setIconState] = useState<{ busy: boolean; error: string }>({ busy: false, error: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const repoRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ;(focus === 'repo' ? repoRef : nameRef).current?.focus()
  }, [focus])

  const title = mode === 'new' ? 'New workspace' : `Edit ${initial.name}`
  const shownSlug = mode === 'new' ? slugifyWorkspace(name) : slug

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    // a picture still being prepared would be left behind
    if (busy || iconState.busy) return
    setBusy(true)
    setError('')
    try {
      const outcome = await onSubmit({ name, color, gitPath, icon, slug: mode === 'edit' ? slug : undefined, templateId: mode === 'new' ? templateId : undefined })
      if (outcome.ok) onClose()
      else setError(outcome.reason)
    } finally {
      setBusy(false)
    }
  }

  const chooseFolder = async (): Promise<void> => {
    try {
      const folder = await selectFolder()
      if (folder) setGitPath(folder)
    } catch (err) {
      setError(`Couldn't open the folder picker: ${errorMessage(err)}`)
    }
  }

  const swatches = WORKSPACE_COLORS.includes(color) ? WORKSPACE_COLORS : [...WORKSPACE_COLORS, color]

  const pickImage = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    // cleared, so choosing the same file again still counts as a change
    event.target.value = ''
    if (!file) return
    setIconState({ busy: true, error: '' })
    try {
      setIcon(await storeWorkspaceIcon(file))
      setIconState({ busy: false, error: '' })
    } catch (err) {
      setIconState({ busy: false, error: errorMessage(err) })
    }
  }

  return (
    <ModalShell label={title} onClose={onClose} width="var(--ws-form-width)" closeOnBackdrop={false}>
      <form className="ws-form" onSubmit={submit} noValidate>
        <h2 className="ws-form-title">{title}</h2>

        <div className="ws-field">
          <label className="field-label" htmlFor="ws-form-name">Name</label>
          <input
            id="ws-form-name"
            ref={nameRef}
            className="input-base"
            value={name}
            onChange={event => { setName(event.target.value); setError('') }}
            placeholder="Side project"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'ws-form-error' : 'ws-form-slug'}
          />
          {error ? (
            <p id="ws-form-error" className="ws-field-error" role="alert">{error}</p>
          ) : (
            shownSlug && <p id="ws-form-slug" className="ws-field-hint">Short name #{shownSlug}</p>
          )}
        </div>

        <div className="ws-field">
          <span className="field-label" id="ws-form-colour">Colour</span>
          <div className="ws-swatches">
            <div role="radiogroup" aria-labelledby="ws-form-colour" className="ws-swatches" onKeyDown={event => moveChoice(event, swatches, color, setColor)}>
              {swatches.map(swatch => (
                <button
                  key={swatch}
                  type="button"
                  role="radio"
                  aria-checked={swatch === color}
                  aria-label={swatch}
                  tabIndex={swatch === color ? 0 : -1}
                  className="ws-swatch"
                  style={{ '--ws-color': swatch } as React.CSSProperties}
                  onClick={() => setColor(swatch)}
                />
              ))}
            </div>
            <ColorPicker value={color} onCommit={setColor} swatchSize={22} hexInputWidth={64} title="Any colour" />
          </div>
        </div>

        <div className="ws-field">
          <span className="field-label" id="ws-form-image">Image</span>
          <div className="ws-image-row">
            <WorkspaceTile name={name || '#'} color={color} icon={icon || undefined} large />
            <button
              type="button"
              className="btn-secondary"
              aria-describedby="ws-form-image ws-form-image-hint"
              aria-busy={iconState.busy}
              onClick={() => fileRef.current?.click()}
            >
              {iconState.busy ? 'Preparing…' : icon ? 'Change image…' : 'Choose image…'}
            </button>
            {icon && (
              <button type="button" className="ws-link-button" onClick={() => setIcon('')}>Remove</button>
            )}
            <input ref={fileRef} type="file" accept={ICON_TYPES.join(',')} hidden data-testid="ws-form-image-file" onChange={event => void pickImage(event)} />
          </div>
          {iconState.error ? (
            <p className="ws-field-error" role="alert">{iconState.error}</p>
          ) : (
            <p id="ws-form-image-hint" className="ws-field-hint">Optional. Shown instead of the letter, trimmed to a square.</p>
          )}
        </div>

        <div className="ws-field">
          <label className="field-label" htmlFor="ws-form-repo">Repository folder</label>
          <div className="ws-field-row">
            <input
              id="ws-form-repo"
              ref={repoRef}
              className="input-base"
              value={gitPath}
              onChange={event => setGitPath(event.target.value)}
              placeholder="C:/projects/my-repo"
              spellCheck={false}
            />
            <button type="button" className="btn-secondary" onClick={() => void chooseFolder()}>Choose…</button>
          </div>
          <p className="ws-field-hint">Optional. The Git panel, the calendar and the GitHub connection read it.</p>
        </div>

        {mode === 'edit' && (
          <div className="ws-field">
            <label className="field-label" htmlFor="ws-form-slug-input">Short name</label>
            <input
              id="ws-form-slug-input"
              className="input-base"
              value={slug}
              onChange={event => setSlug(slugifyWorkspace(event.target.value))}
              spellCheck={false}
            />
            <p className="ws-field-hint">Changing it moves the workspace's board, notes and history to the new name.</p>
          </div>
        )}

        {mode === 'new' && (
          <div className="ws-field">
            <span className="field-label" id="ws-form-template">Start from</span>
            <div role="radiogroup" aria-labelledby="ws-form-template" className="ws-templates" onKeyDown={event => moveChoice(event, PROJECT_TEMPLATES.map(t => t.id), templateId, setTemplateId)}>
              {PROJECT_TEMPLATES.map(template => (
                <button
                  key={template.id}
                  type="button"
                  role="radio"
                  aria-checked={template.id === templateId}
                  tabIndex={template.id === templateId ? 0 : -1}
                  className="ws-template"
                  onClick={() => setTemplateId(template.id)}
                >
                  <span className="ws-template-name">{template.name}</span>
                  <span className="ws-template-about">{template.description} · {describeTemplate(template)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ws-form-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" aria-busy={busy}>
            {busy ? (mode === 'new' ? 'Creating…' : 'Saving…') : mode === 'new' ? 'Create workspace' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}
