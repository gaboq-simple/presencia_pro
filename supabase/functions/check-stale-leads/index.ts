// @ts-nocheck — Deno environment
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async () => {
  const portalUrl = Deno.env.get('SELLERS_PORTAL_URL')
  const cronSecret = Deno.env.get('CRON_SECRET')

  if (!portalUrl || !cronSecret) {
    console.error('check-stale-leads: Missing SELLERS_PORTAL_URL or CRON_SECRET')
    return new Response('Config error', { status: 500 })
  }

  const response = await fetch(
    `${portalUrl}/api/internal/check-stale-leads`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
        'Content-Type': 'application/json',
      },
    },
  )

  const body = await response.text()
  console.log(`check-stale-leads: ${response.status} — ${body}`)

  return new Response(body, { status: response.status })
})
