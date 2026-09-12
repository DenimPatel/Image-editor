/**
 * Passport / ID photo specifications.
 *
 * All physical dimensions are millimetres so they can be converted to pixels
 * at the required print DPI by `mmToPx`. Head height is chin-to-crown and the
 * eye line is measured from the bottom edge of the photo.
 */

export type PassportBackground = 'white' | 'light-grey' | 'any';

export type PassportSpec = {
  id: string;
  label: string;
  country: string;
  widthMm: number;
  heightMm: number;
  dpi: number;
  headHeightMm: { min: number; max: number };
  eyeLineMmFromBottom: { min: number; max: number };
  background: PassportBackground;
  notes: string[];
};

export const PASSPORT_SPECS: PassportSpec[] = [
  {
    id: 'us-2x2',
    label: 'US Passport 2×2 in',
    country: 'United States',
    widthMm: 50.8,
    heightMm: 50.8,
    dpi: 300,
    headHeightMm: { min: 25.4, max: 34.925 },
    eyeLineMmFromBottom: { min: 28.575, max: 34.925 },
    background: 'white',
    notes: [
      'Face the camera directly with a neutral expression and both eyes open.',
      'Use a plain white or off-white background with no shadows.',
      'Head must be 1 in to 1 3/8 in (25.4–34.925 mm) from chin to crown.',
      'No glasses, hats or head coverings except for religious reasons.',
    ],
  },
  {
    id: 'us-visa-2x2',
    label: 'US Visa 2×2 in',
    country: 'United States',
    widthMm: 50.8,
    heightMm: 50.8,
    dpi: 300,
    headHeightMm: { min: 25.4, max: 34.925 },
    eyeLineMmFromBottom: { min: 28.575, max: 34.925 },
    background: 'white',
    notes: [
      'Photo must be exactly 2×2 in with the head centred.',
      'Eye height must be 1 1/8 in to 1 3/8 in from the bottom.',
      'Neutral expression, no uniform, plain white background.',
      'Taken within the last six months.',
    ],
  },
  {
    id: 'india-2x2',
    label: 'India Passport 2×2 in',
    country: 'India',
    widthMm: 51,
    heightMm: 51,
    dpi: 300,
    headHeightMm: { min: 25, max: 35 },
    eyeLineMmFromBottom: { min: 28, max: 34 },
    background: 'white',
    notes: [
      'Photo size 51×51 mm with a plain white background.',
      'Face should fill most of the frame with a visible full frontal view.',
      'No shadows on the face or background.',
      'Include a full face, front view, with both ears visible.',
    ],
  },
  {
    id: 'uk-35x45',
    label: 'UK Passport 35×45 mm',
    country: 'United Kingdom',
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    headHeightMm: { min: 29, max: 34 },
    eyeLineMmFromBottom: { min: 26, max: 32 },
    background: 'light-grey',
    notes: [
      'Head height must be 29–34 mm from chin to crown.',
      'Eyes should be between 26 mm and 32 mm from the bottom.',
      'Plain light grey or cream background, no patterns.',
      'Neutral expression and mouth closed.',
    ],
  },
  {
    id: 'schengen-35x45',
    label: 'Schengen Visa 35×45 mm',
    country: 'Schengen Area',
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    headHeightMm: { min: 32, max: 36 },
    eyeLineMmFromBottom: { min: 20, max: 28 },
    background: 'white',
    notes: [
      'Photo 35×45 mm with a light plain background.',
      'Face must occupy 70–80% of the photo (32–36 mm chin to crown).',
      'Leave 3–5 mm between the top of the head and the top edge.',
      'Taken within the last six months.',
    ],
  },
  {
    id: 'canada-50x70',
    label: 'Canada Passport 50×70 mm',
    country: 'Canada',
    widthMm: 50,
    heightMm: 70,
    dpi: 300,
    headHeightMm: { min: 31, max: 36 },
    eyeLineMmFromBottom: { min: 30, max: 40 },
    background: 'white',
    notes: [
      'Photo must be 50×70 mm with the face centred.',
      'Head height 31–36 mm from chin to crown.',
      'Plain white or light coloured background.',
      'Neutral expression and no shadows.',
    ],
  },
  {
    id: 'australia-35x45',
    label: 'Australia Passport 35×45 mm',
    country: 'Australia',
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    headHeightMm: { min: 32, max: 36 },
    eyeLineMmFromBottom: { min: 25, max: 30 },
    background: 'white',
    notes: [
      'Photo 35×45 mm with a plain white or light grey background.',
      'Head height 32–36 mm from chin to crown.',
      'Face the camera directly with a neutral expression.',
      'No glasses or headwear except for religious reasons.',
    ],
  },
  {
    id: 'china-33x48',
    label: 'China Passport 33×48 mm',
    country: 'China',
    widthMm: 33,
    heightMm: 48,
    dpi: 300,
    headHeightMm: { min: 28, max: 33 },
    eyeLineMmFromBottom: { min: 24, max: 30 },
    background: 'white',
    notes: [
      'Photo 33×48 mm with a plain white background.',
      'Head width 15–22 mm and head height 28–33 mm.',
      'Face the camera directly with a neutral expression.',
      'No hats or head coverings unless religious.',
    ],
  },
  {
    id: 'japan-35x45',
    label: 'Japan Passport 35×45 mm',
    country: 'Japan',
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    headHeightMm: { min: 30, max: 36 },
    eyeLineMmFromBottom: { min: 24, max: 30 },
    background: 'white',
    notes: [
      'Photo 35×45 mm with a plain white background.',
      'Head height should occupy roughly two thirds of the frame.',
      'Neutral expression, mouth closed and both eyes open.',
      'No hat or head covering except for religious reasons.',
    ],
  },
  {
    id: 'oci-51x51',
    label: 'India OCI 51×51 mm',
    country: 'India',
    widthMm: 51,
    heightMm: 51,
    dpi: 300,
    headHeightMm: { min: 25, max: 35 },
    eyeLineMmFromBottom: { min: 28, max: 34 },
    background: 'white',
    notes: [
      'OCI card photo 51×51 mm (2×2 in).',
      'Plain white background with the face centred.',
      'Neutral expression with both eyes open.',
      'No shadows on the face or background.',
    ],
  },
  {
    id: 'generic-35x45',
    label: 'Generic ID 35×45 mm',
    country: 'Any',
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    headHeightMm: { min: 29, max: 34 },
    eyeLineMmFromBottom: { min: 25, max: 31 },
    background: 'any',
    notes: [
      'Generic 35×45 mm ID photo with a plain background.',
      'Face the camera directly with a neutral expression.',
      'Head height 29–34 mm from chin to crown.',
      'No glasses, hats or heavy shadows.',
    ],
  },
];

export function getSpec(id: string): PassportSpec | undefined {
  return PASSPORT_SPECS.find((spec) => spec.id === id);
}