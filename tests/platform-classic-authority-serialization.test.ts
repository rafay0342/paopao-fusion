import { afterEach, describe, expect, it, vi } from 'vitest';

function response(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function ticket(ticketId: string) {
  return {
    duplicate: false,
    ticketId,
    ticketToken: `${ticketId}-token-${'x'.repeat(32)}`,
    runId: `${ticketId}-run`,
    level: 0,
    mode: 'classic' as const,
    startedAt: '2026-07-23T00:00:00.000Z',
    expiresAt: '2026-07-23T00:10:00.000Z',
    rulesVersion: 1,
    requiredShots: 1,
    requiredProofHits: 1,
    minimumDurationMs: 500,
    target: { sequence: 0, lane: 0, angleMilliDegrees: 0, toleranceLanes: 1 },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('classic authority start ordering', () => {
  it('does not send a newer start until the preceding server mutation settles', async () => {
    let resolveFirst: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(response(ticket('ctk_newer')));
    vi.stubGlobal('fetch', fetchMock);

    const { beginClassicRunAuthorityV3 } = await import('../src/game/platform');
    const staleStart = beginClassicRunAuthorityV3({
      level: 0,
      mode: 'classic',
      idempotencyKey: 'classic-start-stale',
    });
    const newerStart = beginClassicRunAuthorityV3({
      level: 0,
      mode: 'classic',
      idempotencyKey: 'classic-start-newer',
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveFirst?.(response(ticket('ctk_stale')));
    await expect(staleStart).resolves.toMatchObject({ ticketId: 'ctk_stale' });
    await expect(newerStart).resolves.toMatchObject({ ticketId: 'ctk_newer' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      idempotencyKey: 'classic-start-stale',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      idempotencyKey: 'classic-start-newer',
    });
  });

  it('continues the serial queue after a failed start', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response(ticket('ctk_recovered')));
    vi.stubGlobal('fetch', fetchMock);

    const { beginClassicRunAuthorityV3 } = await import('../src/game/platform');
    const failed = beginClassicRunAuthorityV3({
      level: 0,
      mode: 'classic',
      idempotencyKey: 'classic-start-failed',
    });
    const recovered = beginClassicRunAuthorityV3({
      level: 0,
      mode: 'classic',
      idempotencyKey: 'classic-start-recovered',
    });

    await expect(failed).rejects.toThrow('offline');
    await expect(recovered).resolves.toMatchObject({ ticketId: 'ctk_recovered' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
