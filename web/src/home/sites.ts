// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

/** Apollo landing sites. lat: N+, lon: E+ (degrees). */
// source: LROC, to be verified by the data team
export interface ApolloSite {
  id: string
  /** Mission proper name; do not translate. */
  name: string
  lat: number
  lon: number
  year: number
}

export const APOLLO_SITES: readonly ApolloSite[] = [
  { id: 'apollo11', name: 'Apollo 11', lat: 0.674, lon: 23.473, year: 1969 },
  { id: 'apollo12', name: 'Apollo 12', lat: -3.012, lon: -23.422, year: 1969 },
  { id: 'apollo14', name: 'Apollo 14', lat: -3.645, lon: -17.471, year: 1971 },
  { id: 'apollo15', name: 'Apollo 15', lat: 26.132, lon: 3.634, year: 1971 },
  { id: 'apollo16', name: 'Apollo 16', lat: -8.973, lon: 15.5, year: 1972 },
  { id: 'apollo17', name: 'Apollo 17', lat: 20.191, lon: 30.772, year: 1972 },
]

/** Boundary of the highlighted south pole region (degrees latitude). */
export const SOUTH_POLE_REGION_LAT = -84
