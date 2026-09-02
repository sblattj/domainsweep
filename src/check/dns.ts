import { resolveNs, resolveSoa } from "node:dns/promises";

export type DnsVerdict = { taken: true; detail: string } | { taken: false; detail: string };

/**
 * DNS is only a fast path for the TAKEN case. Absence of NS/SOA records is
 * NEVER proof of availability (parked-but-unlinked, resolver failure, timeout),
 * so every non-positive outcome returns taken:false and the ladder continues.
 */
export async function dnsTaken(domain: string, timeoutMs: number): Promise<DnsVerdict> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DnsVerdict>((resolve) => {
    timer = setTimeout(() => resolve({ taken: false, detail: "dns: TIMEOUT" }), timeoutMs);
  });
  try {
    return await Promise.race([lookup(domain), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function lookup(domain: string): Promise<DnsVerdict> {
  try {
    const ns = await resolveNs(domain);
    if (ns && ns.length > 0) return { taken: true, detail: `dns: ${ns.length} NS` };
  } catch (err) {
    const code = errCode(err);
    if (code === "ENOTFOUND" || code === "ENODATA") {
      // fall through to SOA: some zones answer SOA but not NS
    } else {
      return { taken: false, detail: `dns: ${code}` };
    }
  }
  try {
    const soa = await resolveSoa(domain);
    if (soa && soa.nsname) return { taken: true, detail: `dns: SOA ${soa.nsname}` };
    return { taken: false, detail: "dns: NXDOMAIN" };
  } catch (err) {
    const code = errCode(err);
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { taken: false, detail: "dns: NXDOMAIN" };
    }
    return { taken: false, detail: `dns: ${code}` };
  }
}

function errCode(err: unknown): string {
  const e = err as { code?: string; message?: string } | undefined;
  return e?.code ?? e?.message ?? "ERROR";
}
