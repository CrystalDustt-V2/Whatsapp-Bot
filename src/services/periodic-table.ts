export interface ElementInfo {
  atomicNumber: number;
  symbol: string;
  name: string;
  atomicMass: string;
  category: string;
}

const ELEMENTS: ElementInfo[] = [
  { atomicNumber: 1, symbol: 'H', name: 'Hydrogen', atomicMass: '1.008', category: 'nonmetal' },
  { atomicNumber: 2, symbol: 'He', name: 'Helium', atomicMass: '4.0026', category: 'noble gas' },
  { atomicNumber: 3, symbol: 'Li', name: 'Lithium', atomicMass: '6.94', category: 'alkali metal' },
  { atomicNumber: 4, symbol: 'Be', name: 'Beryllium', atomicMass: '9.0122', category: 'alkaline earth metal' },
  { atomicNumber: 5, symbol: 'B', name: 'Boron', atomicMass: '10.81', category: 'metalloid' },
  { atomicNumber: 6, symbol: 'C', name: 'Carbon', atomicMass: '12.011', category: 'nonmetal' },
  { atomicNumber: 7, symbol: 'N', name: 'Nitrogen', atomicMass: '14.007', category: 'nonmetal' },
  { atomicNumber: 8, symbol: 'O', name: 'Oxygen', atomicMass: '15.999', category: 'nonmetal' },
  { atomicNumber: 9, symbol: 'F', name: 'Fluorine', atomicMass: '18.998', category: 'halogen' },
  { atomicNumber: 10, symbol: 'Ne', name: 'Neon', atomicMass: '20.180', category: 'noble gas' },
  { atomicNumber: 11, symbol: 'Na', name: 'Sodium', atomicMass: '22.990', category: 'alkali metal' },
  { atomicNumber: 12, symbol: 'Mg', name: 'Magnesium', atomicMass: '24.305', category: 'alkaline earth metal' },
  { atomicNumber: 13, symbol: 'Al', name: 'Aluminium', atomicMass: '26.982', category: 'post-transition metal' },
  { atomicNumber: 14, symbol: 'Si', name: 'Silicon', atomicMass: '28.085', category: 'metalloid' },
  { atomicNumber: 15, symbol: 'P', name: 'Phosphorus', atomicMass: '30.974', category: 'nonmetal' },
  { atomicNumber: 16, symbol: 'S', name: 'Sulfur', atomicMass: '32.06', category: 'nonmetal' },
  { atomicNumber: 17, symbol: 'Cl', name: 'Chlorine', atomicMass: '35.45', category: 'halogen' },
  { atomicNumber: 18, symbol: 'Ar', name: 'Argon', atomicMass: '39.948', category: 'noble gas' },
  { atomicNumber: 19, symbol: 'K', name: 'Potassium', atomicMass: '39.098', category: 'alkali metal' },
  { atomicNumber: 20, symbol: 'Ca', name: 'Calcium', atomicMass: '40.078', category: 'alkaline earth metal' },
  { atomicNumber: 26, symbol: 'Fe', name: 'Iron', atomicMass: '55.845', category: 'transition metal' },
  { atomicNumber: 29, symbol: 'Cu', name: 'Copper', atomicMass: '63.546', category: 'transition metal' },
  { atomicNumber: 30, symbol: 'Zn', name: 'Zinc', atomicMass: '65.38', category: 'transition metal' },
  { atomicNumber: 47, symbol: 'Ag', name: 'Silver', atomicMass: '107.87', category: 'transition metal' },
  { atomicNumber: 53, symbol: 'I', name: 'Iodine', atomicMass: '126.90', category: 'halogen' },
  { atomicNumber: 79, symbol: 'Au', name: 'Gold', atomicMass: '196.97', category: 'transition metal' },
  { atomicNumber: 80, symbol: 'Hg', name: 'Mercury', atomicMass: '200.59', category: 'transition metal' },
  { atomicNumber: 82, symbol: 'Pb', name: 'Lead', atomicMass: '207.2', category: 'post-transition metal' },
  { atomicNumber: 92, symbol: 'U', name: 'Uranium', atomicMass: '238.03', category: 'actinide' },
];

export function findElement(query: string): ElementInfo | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  const atomicNumber = Number(normalized);
  if (Number.isInteger(atomicNumber)) {
    return ELEMENTS.find((element) => element.atomicNumber === atomicNumber) || null;
  }

  return ELEMENTS.find(
    (element) =>
      element.symbol.toLowerCase() === normalized ||
      element.name.toLowerCase() === normalized
  ) || null;
}
