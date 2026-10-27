// Where proposals live between "proposed", "approved" and "executed". A JSON file is enough for a single-user demo.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Proposal, ProposalStore } from './proposals.js'

// Both stores hand out copies, so a caller only changes state through save()
export class MemoryStore implements ProposalStore {
  private readonly items = new Map<string, Proposal>()

  async get(id: string) {
    const item = this.items.get(id)
    return item && structuredClone(item)
  }

  async save(proposal: Proposal) {
    this.items.set(proposal.id, structuredClone(proposal))
  }

  async list() {
    return [...this.items.values()].map((p) => structuredClone(p))
  }
}

export class JsonFileStore implements ProposalStore {
  // Writes run one at a time so concurrent saves never drop each other
  private queue: Promise<unknown> = Promise.resolve()

  constructor(readonly path = 'data/proposals.json') {}

  private async read(): Promise<Record<string, Proposal>> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as Record<string, Proposal>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
  }

  async get(id: string) {
    await this.queue
    return (await this.read())[id]
  }

  async list() {
    await this.queue
    return Object.values(await this.read())
  }

  save(proposal: Proposal): Promise<void> {
    const write = this.queue.then(async () => {
      const all = await this.read()
      all[proposal.id] = proposal
      await mkdir(dirname(this.path), { recursive: true })
      // Write then rename: a crash mid-write never leaves a half-written file
      const tmp = `${this.path}.tmp`
      await writeFile(tmp, JSON.stringify(all, null, 2))
      await rename(tmp, this.path)
    })
    this.queue = write.catch(() => {})
    return write
  }
}
