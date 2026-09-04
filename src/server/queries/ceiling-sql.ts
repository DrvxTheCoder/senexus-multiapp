import "server-only"

import { Prisma } from "@prisma/client"

/**
 * Cumulative interim days per employee, within one firm.
 *
 * The single SQL definition of the 730-day ceiling, shared by the contracts
 * resolver, the employees resolver and the dashboard aggregates. Duplicating it
 * would be how the contracts page and the dashboard start disagreeing about how
 * many people are over the limit.
 *
 * Three things it gets right, all of which a naive `SUM(endDate - startDate)`
 * gets wrong:
 *
 * - **Per employer.** The CTE is firm-scoped, so days worked for another group
 *   firm are invisible here by construction rather than by convention (§6).
 * - **Overlaps count once.** `range_agg` unions the periods before measuring.
 * - **Inclusive bounds.** `+ 1` on the upper bound, so a contract that runs
 *   from the 1st to the 1st is one worked day rather than zero.
 *
 * `worked` stops at today; `contracted` runs to the contractual end. The first
 * is what the meter shows, the second is what the renewal pre-flight tests.
 *
 * Exposes a CTE named `ceiling` with `employee_id`, `used_days` and
 * `projected_days`. Use as: WITH ${interimCeilingCte(firmId)} SELECT …
 */
export function interimCeilingCte(firmId: string): Prisma.Sql {
  return Prisma.sql`
    interim_periods AS (
      SELECT
        c."employeeId" AS employee_id,
        daterange(c."startDate"::date,
                  (LEAST(COALESCE(c."endDate", now()), now()))::date + 1) AS worked,
        daterange(c."startDate"::date,
                  COALESCE(c."endDate", now())::date + 1) AS contracted
      FROM contracts c
      WHERE c."firmId" = ${firmId}
        AND c."type" = 'INTERIM'
        AND c."startDate" <= now()
    ),
    ceiling AS (
      SELECT
        employee_id,
        (SELECT COALESCE(SUM(upper(r) - lower(r)), 0)
           FROM unnest(range_agg(worked)) r) AS used_days,
        (SELECT COALESCE(SUM(upper(r) - lower(r)), 0)
           FROM unnest(range_agg(contracted)) r) AS projected_days
      FROM interim_periods
      GROUP BY employee_id
    )
  `
}
