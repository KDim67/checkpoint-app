// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { siGithub, siJira, siLinear, siNotion, siObsidian, siTodoist } from 'simple-icons'
import ServiceLogo from '../src/renderer/src/components/ui/ServiceLogo'
import LinkBadge from '../src/renderer/src/components/kanban/LinkBadge'
import { CONNECTION_SERVICES } from '../src/shared/connections'

afterEach(cleanup)

const EXPECTED = { github: siGithub, todoist: siTodoist, linear: siLinear, jira: siJira, notion: siNotion, obsidian: siObsidian }

describe('each service\'s logo', () => {
  it('is that service\'s own mark, marked for its colour and hidden from screen readers', () => {
    for (const service of CONNECTION_SERVICES) {
      const { container } = render(<ServiceLogo service={service} />)
      const svg = container.querySelector('svg') as SVGSVGElement
      expect(svg.getAttribute('data-service')).toBe(service)
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      expect(svg.querySelector('path')?.getAttribute('d')).toBe(EXPECTED[service].path)
      cleanup()
    }
  })

  it('shows on a card\'s badge', () => {
    const { container } = render(<LinkBadge link={{ service: 'jira', id: '1', url: 'https://acme.atlassian.net/browse/ENG-1', state: 'open', labels: [], ref: 'ENG-1' }} />)
    expect(container.querySelector('.link-badge svg')?.getAttribute('data-service')).toBe('jira')
  })
})
