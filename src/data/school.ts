/* The school's own identity, as the SF8 header block wants it.

   These are the cells at the top of the form that never change from one
   weigh-in to the next. They live here rather than in the exporter because a
   second school adopting CHAS changes this file and nothing else.

   `id` is deliberately blank. A DepEd School ID is issued, not invented, and
   this one is not on file - the export leaves the cell empty for the school to
   write in rather than printing a number nobody can vouch for. */
export const SCHOOL = {
  name: 'Detailen Elementary School',
  id: '',
  district: 'Maria Aurora East',
  division: 'Aurora',
  region: 'III - CENTRAL LUZON',
  schoolYear: '2026-2027',
} as const
