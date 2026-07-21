export interface ExclusiveOperation {
  run<Result>(operation: () => Promise<Result>): Promise<Result>
}

export function createExclusiveOperation(busyMessage: string): ExclusiveOperation {
  let active = false

  return {
    async run(operation) {
      if (active) throw new Error(busyMessage)

      active = true

      try {
        return await operation()
      } finally {
        active = false
      }
    },
  }
}
