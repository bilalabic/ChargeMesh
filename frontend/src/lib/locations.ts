export interface NeighborhoodOption {
  name: string;
  lat: number;
  lng: number;
}

export interface DistrictOption {
  name: string;
  neighborhoods: readonly NeighborhoodOption[];
}

export interface CityOption {
  name: string;
  districts: readonly DistrictOption[];
}

export interface LocationSelection {
  city: string;
  district: string;
  neighborhood: string;
}

/**
 * Demo-friendly destination catalogue. Coordinates are neighborhood centroids and
 * stay behind the UI so users choose a familiar place instead of entering lat/lng.
 */
export const LOCATION_OPTIONS: readonly CityOption[] = [
  {
    name: "İstanbul",
    districts: [
      {
        name: "Kadıköy",
        neighborhoods: [
          { name: "Caferağa", lat: 40.9869, lng: 29.0267 },
          { name: "Fenerbahçe", lat: 40.9699, lng: 29.0369 },
          { name: "Koşuyolu", lat: 41.0067, lng: 29.0395 },
        ],
      },
      {
        name: "Beşiktaş",
        neighborhoods: [
          { name: "Levent", lat: 41.0812, lng: 29.0114 },
          { name: "Etiler", lat: 41.0767, lng: 29.0282 },
          { name: "Ortaköy", lat: 41.0474, lng: 29.0269 },
        ],
      },
      {
        name: "Şişli",
        neighborhoods: [
          { name: "Teşvikiye", lat: 41.0504, lng: 28.9948 },
          { name: "Mecidiyeköy", lat: 41.0668, lng: 28.9967 },
          { name: "Esentepe", lat: 41.0708, lng: 29.0084 },
        ],
      },
    ],
  },
  {
    name: "Ankara",
    districts: [
      {
        name: "Çankaya",
        neighborhoods: [
          { name: "Kızılay", lat: 39.9208, lng: 32.8541 },
          { name: "Bahçelievler", lat: 39.9234, lng: 32.8268 },
          { name: "Çukurambar", lat: 39.9098, lng: 32.8097 },
        ],
      },
      {
        name: "Yenimahalle",
        neighborhoods: [
          { name: "Batıkent", lat: 39.9667, lng: 32.7256 },
          { name: "Demetevler", lat: 39.9655, lng: 32.7951 },
        ],
      },
    ],
  },
];

export const DEFAULT_LOCATION: LocationSelection = {
  city: "İstanbul",
  district: "Kadıköy",
  neighborhood: "Caferağa",
};

export function districtsFor(city: string): readonly DistrictOption[] {
  return LOCATION_OPTIONS.find((option) => option.name === city)?.districts ?? [];
}

export function neighborhoodsFor(city: string, district: string): readonly NeighborhoodOption[] {
  return districtsFor(city).find((option) => option.name === district)?.neighborhoods ?? [];
}

export function resolveLocation(selection: LocationSelection): NeighborhoodOption | undefined {
  return neighborhoodsFor(selection.city, selection.district).find(
    (option) => option.name === selection.neighborhood,
  );
}

export function areaLabelFor(selection: LocationSelection): string {
  return `${selection.district}, ${selection.city}`;
}

export function addressLineFor(selection: LocationSelection, addressDetail: string): string {
  return `${selection.neighborhood} Mah. ${addressDetail.trim()}, ${selection.district}/${selection.city}`;
}
