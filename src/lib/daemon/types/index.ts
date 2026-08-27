/** types/ — every daemon wire shape, grouped by domain. One barrel so
 *  the facade (`~/lib/daemon-client`) keeps exporting a flat namespace. */

export type * from './system';
export type * from './config';
export type * from './chat';
export type * from './team';
export type * from './runs';
export type * from './roadmap';
