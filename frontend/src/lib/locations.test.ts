import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCATION,
  LOCATION_OPTIONS,
  addressLineFor,
  areaLabelFor,
  districtsFor,
  neighborhoodsFor,
  resolveLocation,
} from "./locations";

describe("location catalogue", () => {
  it("resolves the default demo neighborhood to the fixture coordinates", () => {
    expect(resolveLocation(DEFAULT_LOCATION)).toEqual({
      name: "Caferağa",
      lat: 40.9869,
      lng: 29.0267,
    });
  });

  it("provides dependent district and neighborhood options", () => {
    expect(LOCATION_OPTIONS.map((city) => city.name)).toEqual(["İstanbul", "Ankara"]);
    expect(districtsFor("İstanbul").map((district) => district.name)).toContain("Kadıköy");
    expect(neighborhoodsFor("İstanbul", "Kadıköy").map((neighborhood) => neighborhood.name)).toContain(
      "Caferağa",
    );
  });

  it("formats API labels and private address lines without exposing coordinates", () => {
    expect(areaLabelFor(DEFAULT_LOCATION)).toBe("Kadıköy, İstanbul");
    expect(addressLineFor(DEFAULT_LOCATION, "Moda Cad. No:1")).toBe(
      "Caferağa Mah. Moda Cad. No:1, Kadıköy/İstanbul",
    );
  });
});
