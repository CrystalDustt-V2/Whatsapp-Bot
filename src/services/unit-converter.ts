type UnitDefinition = {
  aliases: string[];
  toBase(value: number): number;
  fromBase(value: number): number;
};

type UnitCategory = {
  label: string;
  base: string;
  units: Record<string, UnitDefinition>;
};

const CATEGORIES: Record<string, UnitCategory> = {
  length: {
    label: 'Length',
    base: 'm',
    units: {
      mm: linear(['mm', 'millimeter', 'millimeters'], 0.001),
      cm: linear(['cm', 'centimeter', 'centimeters'], 0.01),
      m: linear(['m', 'meter', 'meters'], 1),
      km: linear(['km', 'kilometer', 'kilometers'], 1000),
      in: linear(['in', 'inch', 'inches'], 0.0254),
      ft: linear(['ft', 'foot', 'feet'], 0.3048),
      yd: linear(['yd', 'yard', 'yards'], 0.9144),
      mi: linear(['mi', 'mile', 'miles'], 1609.344),
    },
  },
  weight: {
    label: 'Weight',
    base: 'g',
    units: {
      mg: linear(['mg', 'milligram', 'milligrams'], 0.001),
      g: linear(['g', 'gram', 'grams'], 1),
      kg: linear(['kg', 'kilogram', 'kilograms'], 1000),
      oz: linear(['oz', 'ounce', 'ounces'], 28.349523125),
      lb: linear(['lb', 'lbs', 'pound', 'pounds'], 453.59237),
    },
  },
  temperature: {
    label: 'Temperature',
    base: 'c',
    units: {
      c: {
        aliases: ['c', 'celsius'],
        toBase: (value) => value,
        fromBase: (value) => value,
      },
      f: {
        aliases: ['f', 'fahrenheit'],
        toBase: (value) => (value - 32) * (5 / 9),
        fromBase: (value) => value * (9 / 5) + 32,
      },
      k: {
        aliases: ['k', 'kelvin'],
        toBase: (value) => value - 273.15,
        fromBase: (value) => value + 273.15,
      },
    },
  },
  data: {
    label: 'Data',
    base: 'b',
    units: {
      b: linear(['b', 'byte', 'bytes'], 1),
      kb: linear(['kb', 'kilobyte', 'kilobytes'], 1024),
      mb: linear(['mb', 'megabyte', 'megabytes'], 1024 ** 2),
      gb: linear(['gb', 'gigabyte', 'gigabytes'], 1024 ** 3),
      tb: linear(['tb', 'terabyte', 'terabytes'], 1024 ** 4),
    },
  },
};

const UNIT_INDEX = buildUnitIndex();

function linear(aliases: string[], multiplier: number): UnitDefinition {
  return {
    aliases,
    toBase: (value) => value * multiplier,
    fromBase: (value) => value / multiplier,
  };
}

function buildUnitIndex(): Map<string, { category: string; key: string; unit: UnitDefinition }> {
  const index = new Map<string, { category: string; key: string; unit: UnitDefinition }>();

  for (const [category, definition] of Object.entries(CATEGORIES)) {
    for (const [key, unit] of Object.entries(definition.units)) {
      index.set(key, { category, key, unit });
      for (const alias of unit.aliases) {
        index.set(alias, { category, key, unit });
      }
    }
  }

  return index;
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) {
    return Number(value.toPrecision(8)).toString();
  }

  return Number(value.toFixed(4)).toString();
}

export function convertUnit(value: number, fromUnit: string, toUnit: string): string | null {
  const from = UNIT_INDEX.get(fromUnit.toLowerCase());
  const to = UNIT_INDEX.get(toUnit.toLowerCase());

  if (!from || !to || from.category !== to.category) {
    return null;
  }

  const baseValue = from.unit.toBase(value);
  const converted = to.unit.fromBase(baseValue);
  const category = CATEGORIES[from.category];

  return `${formatNumber(value)} ${from.key} = ${formatNumber(converted)} ${to.key} (${category.label})`;
}

export function getUnitHelp(): string {
  return Object.values(CATEGORIES)
    .map((category) => `${category.label}: ${Object.keys(category.units).join(', ')}`)
    .join('\n');
}
