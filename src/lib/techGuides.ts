/**
 * Tech Tips / Repair Guides — per-appliance troubleshooting guides shown
 * inside a ticket (mobile "Tech Tips" tab, desktop Tracking tab).
 *
 * DEFAULT_TECH_GUIDES is the company's "Tech Protocols" document as the
 * built-in starting point. A company can edit any guide from the Tech
 * Guides page (migration 0328, table tech_guides); a saved row replaces the
 * default with the same key, and deleting it restores the default.
 *
 * Matching: the ticket's Product Category (a fixed dropdown) picks the
 * guide; the CSR's free-text symptom only decides which section opens first
 * (keyword match) — every section stays one tap away.
 */

export type TechGuideReadingKind = "text" | "choice";

export interface TechGuideReading {
  id: string;
  label: string;
  kind: TechGuideReadingKind;
  /** Choice options (kind === "choice"). */
  options?: string[];
}

export interface TechGuideSection {
  id: string;
  title: string;
  /** Explanation paragraph(s). */
  body: string;
  /** Things to check / test — shown as a tickable checklist. */
  steps: string[];
  /** Lower-case words/phrases matched against the ticket's symptom text. */
  keywords: string[];
}

export interface TechGuide {
  key: string;
  title: string;
  /** Product Category values (NewTicketPage's PRODUCT_CATEGORIES) this guide covers. */
  productCategories: string[];
  /** How the appliance works — shown above the sections. */
  intro: string;
  sections: TechGuideSection[];
  /** The guide's test checklist — values the tech records per visit. */
  readings: TechGuideReading[];
}

const text = (id: string, label: string): TechGuideReading => ({ id, label, kind: "text" });
const choice = (id: string, label: string, options: string[]): TechGuideReading => ({ id, label, kind: "choice", options });

export const DEFAULT_TECH_GUIDES: TechGuide[] = [
  {
    key: "refrigerator",
    title: "Refrigerator",
    productCategories: ["Refrigerator", "Food Center", "Ice Maker", "Wine Cellar"],
    intro:
      "For the cooling system to work properly, several components must function as one. The compressor pushes refrigerant through the system; the refrigerant goes through the condenser/body of the unit to dissipate heat, then through the capillary tube, which turns it into a low-pressure, low-temperature liquid. It then goes through the evaporator, cooling the coils (which produces frost). The evaporator fan circulates that cold air through the unit, and the refrigerant returns to the compressor to repeat the cycle.\n\n" +
      "The system also relies on several temperature sensors: 2 on the evaporator coils, 1–2 in each section (fresh food and freezer) and an ambient sensor. Some are plugged in and some are hardlined into the cabinet — test the hardlined ones for resistance at the main control board; the reading depends on the temperature.\n\n" +
      "Air flow is a big factor: if the cabinet channels or the machine compartment don't get proper air flow — blocked channels or an overly full unit — the unit will not cool properly.",
    sections: [
      {
        id: "refrigerant",
        title: "Refrigerant system",
        body: "",
        steps: [
          "Check the frost pattern (fridge and freezer if applicable)",
          "Check the compressor and condenser fan (should run in tandem)",
          "Check the condenser — does it need to be cleaned?",
          "Check copper/steel pipes for oil or a potential leak",
          "Test the evap fan motor (ohms + voltage to the fan)",
          "Test the defrost heater (ohms)",
        ],
        keywords: ["not cooling", "no cool", "not cold", "warm", "too warm", "cooling", "compressor", "frost", "temperature", "temp"],
      },
      {
        id: "water-ice",
        title: "Water / ice system",
        body: "",
        steps: [
          "Check the water filter to see if it is frozen",
          "Check the house-side water line for kinks",
          "Run a test to verify the icemaker is running (dropping, returning to home, and filling)",
          "Check external water lines for cracks/leaks",
          "Check the RFID board",
          "Disconnect water line connections and work your way back to see where the water stops",
        ],
        keywords: ["ice", "icemaker", "ice maker", "water", "dispenser", "dispense", "leak", "leaking", "filter", "no water"],
      },
      {
        id: "air-flow",
        title: "Air flow",
        body: "",
        steps: [
          "Check the duct between the freezer and fresh food sections (a spilled liquid can cause complete or partial cooling loss)",
          "Check the defrost heater (if it isn't working, ice builds up and restricts the air flow)",
          "Check the evap fan (it circulates the air — if the motor isn't spinning it presents as a no-cool)",
        ],
        keywords: ["fresh food", "freezer", "iced up", "ice build", "frost build", "fan", "air", "noise", "noisy", "not cooling", "warm"],
      },
    ],
    readings: [
      text("fresh-food-temp", "Fresh food temperature"),
      text("freezer-temp", "Freezer temperature"),
      choice("frost-pattern", "Frost pattern", ["Full", "Partial", "None"]),
      choice("evap-fan", "Evaporator fan", ["Running", "Not running"]),
      choice("condenser-fan", "Condenser fan", ["Running", "Not running"]),
      text("outlet-power", "Power reading (outlet)"),
      text("compressor-voltage", "Compressor voltage"),
    ],
  },
  {
    key: "oven-range",
    title: "Oven / Range",
    productCategories: ["Oven", "Range", "Electric Oven range", "Cooktop", "Electric Cooktop"],
    intro: "",
    sections: [
      {
        id: "oven-elements",
        title: "Oven elements",
        body: "Most ovens have two elements, bake and broil. Some units have more, but they all do the same thing in different sequences.",
        steps: [
          "Test all elements for resistance",
          "Check the temp sensors (an open-line temperature sensor can cause a low/high temp issue)",
          "Check the wire harness for voltage to make sure the main control board is sending voltage to the elements",
        ],
        keywords: ["not heating", "no heat", "won't heat", "bake", "broil", "oven", "temperature", "temp", "too hot", "not hot"],
      },
      {
        id: "cooktop-elements",
        title: "Cooktop elements",
        body: "Electric cooktop elements still use ceramic shielding and glass thermostats. These thermostats like to crack.",
        steps: [
          "Check the glass vials for cracks and the ceramic for damage",
          "Test the element for resistance, and test the thermostat",
          "If an element stays on high with no adjustment, its thermostat is out — or the infinite switch is stuck on one setting",
          "Make sure all the regulators reach the correct temps at the desired setting",
        ],
        keywords: ["burner", "cooktop", "surface", "stove top", "stovetop", "element", "stays on", "high", "infinite switch"],
      },
      {
        id: "cooling-system",
        title: "Cooling system",
        body: "Most units have a cooling fan. If it isn't working, some models show an error code and some just overheat.",
        steps: [
          "Check the cooling fan resistance, and inspect it for burnt wires or coils (burnt coils are a good sign of age and need of replacement)",
          "If the unit is overheating, inspect the wiring harness for damage — harness damage causes issues now or down the line",
        ],
        keywords: ["overheat", "overheating", "fan", "error", "code", "hot", "shuts off", "shut off"],
      },
    ],
    readings: [
      text("bake-ohms", "Bake element resistance"),
      text("bake-voltage", "Bake element voltage"),
      text("broil-ohms", "Broil element resistance"),
      text("broil-voltage", "Broil element voltage"),
      text("l1n", "L1+N voltage"),
      text("l2n", "L2+N voltage"),
      text("l1l2", "L1+L2 voltage"),
      text("cooling-fan", "Cooling fan function"),
      text("temp-350", "Oven temperature reading at 350°F"),
    ],
  },
  {
    key: "dishwasher",
    title: "Dishwasher",
    productCategories: ["Dishwasher"],
    intro:
      "Dishwashers are a sanitation unit — hot water and detergent clean and sanitize the dishes; they don't scrub or dry them. Water comes in through the water valve and pools at the bottom of the cavity. Once the level is reached the circulation pump pumps it through the ducting to both sprayer arms (that water pressure is what spins them).\n\n" +
      "The first 5–10 minutes rinse off loose debris and start a \"soak\", then the drain pump drains all the water. The heating element turns on, fresh water comes in, the circulation pump restarts and the detergent is released — the dishwasher starts \"cleaning dishes\". Some models have diverter valves that switch which cleaning zone the water is pumped to.",
    sections: [
      {
        id: "sump",
        title: "Sump assembly",
        body: "",
        steps: [
          "Check the circulation pump for leaks and anything blocking the fins",
          "Check the drain pump for leaks and broken fins",
          "Check the pressure sensor for clogs/debris (clean out a clog and test the unit for function)",
          "Test the heating element for resistance",
          "Check the diverter valve is switching between cleaning zones (presents as only circulating on one rack)",
        ],
        keywords: ["not draining", "drain", "standing water", "not cleaning", "dirty", "not washing", "pump", "not heating", "one rack", "noise", "humming"],
      },
      {
        id: "door",
        title: "Door assembly",
        body: "",
        steps: [
          "Inspect the gaskets for debris/tears",
          "Inspect the door is sealing and not leaking (on some models a melted sprayer arm, or one hitting dishes, sprays water at the door corner and causes a \"leak\")",
          "Check the door lock makes proper contact with the lock assembly (a bad door lock can present as no power or not starting)",
        ],
        keywords: ["leak", "leaking", "door", "latch", "lock", "no power", "not start", "won't start", "dead"],
      },
      {
        id: "tub",
        title: "Tub assembly",
        body: "",
        steps: [
          "Check the tub for cracks or installation damage (most manufacturers don't make replacement tubs)",
          "Inspect all gaskets and components to make sure there are no leaks",
        ],
        keywords: ["leak", "leaking", "crack", "tub", "water on floor"],
      },
    ],
    readings: [
      text("power", "Power to the unit"),
      text("door-lock-open", "Door lock ohms — open"),
      text("door-lock-closed", "Door lock ohms — closed"),
      text("diverter", "Diverter valve (run 5 minutes, then check the spray pattern)"),
      choice("gasket", "Gasket condition", ["Good", "Poor", "Bad"]),
      choice("drain-hum", "Drain pump humming", ["Yes", "No"]),
      text("clogged", "Any hoses/pumps clogged or damaged? (describe, or No)"),
      choice("filling", "Dishwasher filling", ["Yes", "No"]),
      choice("draining", "Dishwasher draining", ["Yes", "No"]),
      choice("spraying", "Dishwasher spraying water", ["Yes", "No"]),
    ],
  },
  {
    key: "washer",
    title: "Washing machine",
    productCategories: ["Washer", "Washer Dryer", "Laundry"],
    intro:
      "Washing machines are simple machines: the motor, the tub/basket, the water valves and the gearcase. The motor spins the basket for agitate and spin cycles, the water valves put hot/cold water into the tub, and the unit runs different combinations of these depending on the cycle.\n\n" +
      "All units have speed sensors, on the motor or the gearcase. Some models have a motor capacitor that provides start-up power — if it isn't reading the correct microfarads the motor won't start.\n\n" +
      "Every unit has a pressure sensor (separate or on the main control board) that tells the water valves to turn off. It's also a failsafe: if the water is too high or not rising fast enough, it runs the drain pump to prevent a flood.\n\n" +
      "The gearcase lets the unit shift between spin and agitate via a mode shifter/actuator. If any gears inside are stripped or slipping, the unit won't spin or agitate.",
    sections: [
      {
        id: "motor-tub",
        title: "Motor / tub",
        body: "",
        steps: [
          "Test whether the motor is spinning the basket and agitating",
          "Check the belt for damage (a greasy or ripped belt won't spin properly)",
          "Check the pulley (if applicable)",
          "If the motor isn't spinning at all, test the capacitor (it's labeled with the microfarads it should have)",
        ],
        keywords: ["not spin", "won't spin", "no spin", "spin", "agitat", "motor", "belt", "not starting", "won't start", "hum"],
      },
      {
        id: "water",
        title: "Water system",
        body: "",
        steps: [
          "Test the water valves for resistance and voltage",
          "Test the drain pump for voltage and function",
          "If the pressure sensor is separate from the main control, test the pressure sensor",
        ],
        keywords: ["not fill", "won't fill", "fill", "water", "not draining", "drain", "leak", "leaking", "overflow", "rinse", "not completing", "shuts off", "stops mid", "stops during"],
      },
      {
        id: "general",
        title: "General",
        body: "",
        steps: [
          "Check the wiring harness for broken wires (on some models the wiring sits too close to the tub edge, rubs and breaks)",
          "Check the suspension rods — a spring that has lost tension causes shaking",
        ],
        keywords: ["shak", "vibrat", "walking", "loud", "noise", "banging", "off balance", "error", "code"],
      },
    ],
    readings: [
      text("valve-voltage", "Water valve voltage"),
      text("valve-ohms", "Water valve ohms"),
      text("capacitor", "Capacitor microfarads"),
      text("motor-ohms", "Motor ohms"),
      text("drain-voltage", "Drain pump voltage"),
      text("shifter-ohms", "Shifter/actuator ohms"),
      text("outlet-power", "Power received (outlet)"),
      choice("belt", "Motor belt wear and tear", ["Good", "Broken"]),
    ],
  },
  {
    key: "dryer",
    title: "Dryer",
    productCategories: ["Dryer", "Washer Dryer", "Laundry"],
    intro: "",
    sections: [
      {
        id: "motor",
        title: "Motor",
        body: "",
        steps: [
          "Check the belt — snapped or worn down causes slipping and squeaking",
          "Inspect the blower wheel — caked with lint or broken causes noise or heating issues",
          "Inspect the idler arm/pulley — causes noise, or spinning issues if worn down enough",
        ],
        keywords: ["not tumbl", "not spinning", "won't spin", "drum", "squeak", "noise", "loud", "belt", "thump"],
      },
      {
        id: "heating",
        title: "Heating element / thermostats",
        body: "",
        steps: [
          "Inspect the heating element for visible breaks in the coils",
          "Test the heating element for resistance",
          "Test all the thermostats along the heating element and the blower housing",
        ],
        keywords: ["no heat", "not heating", "won't heat", "cold", "heat", "not drying", "takes long", "long time"],
      },
      {
        id: "air-flow",
        title: "Air flow",
        body: "",
        steps: [
          "Inspect the blower housing for clogs, trapped lint, or anything blocking the air flow",
          "Inspect the duct for clogs, kinks or tears",
        ],
        keywords: ["takes long", "long time", "not drying", "overheat", "too hot", "lint", "vent", "duct"],
      },
    ],
    readings: [
      text("l1n", "L1+N voltage"),
      text("l2n", "L2+N voltage"),
      text("l1l2", "L1+L2 voltage"),
      text("thermostat-1", "Thermostat 1 ohms"),
      text("thermostat-2", "Thermostat 2 ohms"),
      text("thermostat-3", "Thermostat 3 ohms"),
      text("thermal-cutoff-1", "Thermal cut-off 1 ohms"),
      text("thermistor-1", "Thermistor 1 ohms"),
      text("thermistor-2", "Thermistor 2 ohms"),
      text("element-12", "Heating element 1+2 ohms"),
      text("element-23", "Heating element 2+3 ohms"),
      text("element-13", "Heating element 1+3 ohms"),
      choice("belt", "Belt condition", ["Good", "Poor", "Bad"]),
      choice("air-flow", "Air flow", ["Good", "Poor", "Bad"]),
      choice("blower", "Blower wheel intact", ["Yes", "No"]),
    ],
  },
  {
    key: "microwave",
    title: "Microwave",
    productCategories: ["Microwave"],
    intro:
      "Microwaves use a magnetron to vibrate the water inside food to heat it. That needs the transformer, the magnetron, 2 cooling fans, a capacitor and several thermostats all working. The magnetron sits in a part of the cabinet that directs the microwaves into the cavity, and has its own thermostat that shuts it off if it overheats. The transformer turns 120V into the voltage the magnetron needs; the capacitor starts the magnetron and the transformer keeps the voltage stable during use.\n\n" +
      "Most thermostats read the temperature of the cabinet and cavity; one only reads once heated, to track the transformer's temperature. The door latch (a holder plus 3–4 micro switches) must be pressed in the correct sequence for the unit to run — a good micro switch reads OL in one position and resistance in the other.",
    sections: [
      {
        id: "power",
        title: "Power / noise filter",
        body: "",
        steps: [
          "Check the noise filter for a blown fuse (a power surge or too much draw should blow the fuse before anything else is damaged)",
          "Power into the first side of the noise filter should be 120V, and 120V out the other side",
          "The main control board splits power into small circuits — without 120V the transformer won't come on, and neither will the magnetron",
        ],
        keywords: ["no power", "dead", "not turn on", "won't turn on", "fuse", "blank", "no display"],
      },
      {
        id: "door-switches",
        title: "Door switches",
        body: "",
        steps: [
          "Test each micro switch — it must read OL in one position and ohms in the other, in the right sequence, for the transformer and magnetron to come on",
          "If the microwave runs constantly (hung), check the trim piece above the door — if the door can't shut fully, constant pressure on the latch keeps sending voltage to the transformer",
        ],
        keywords: ["door", "won't start", "not start", "keeps running", "runs constantly", "hung", "latch", "switch"],
      },
      {
        id: "high-voltage",
        title: "Magnetron / high voltage",
        body: "",
        steps: [
          "Test the capacitor (uF), magnetron and transformer resistance",
          "Some microwaves have a diode — it grounds the capacitor and only lets current flow in one direction",
          "A damaged or sparking magnetron makes the unit unrepairable",
          "All thermostats should read resistance, except the one that only reads once heated",
        ],
        keywords: ["not heating", "no heat", "won't heat", "spark", "sparking", "arcing", "buzz", "noise", "loud"],
      },
      {
        id: "cavity",
        title: "Cavity damage",
        body: "",
        steps: [
          "Most manufacturers don't make a replaceable oven cavity — if it's damaged, call the warranty company to document it and ask how to proceed",
        ],
        keywords: ["cavity", "rust", "damage", "burn", "hole"],
      },
    ],
    readings: [
      text("thermostat-1", "Thermostat 1 ohms"),
      text("thermostat-2", "Thermostat 2 ohms"),
      text("thermostat-3", "Thermostat 3 ohms"),
      text("thermostat-4", "Thermostat 4 ohms"),
      text("thermostat-5", "Thermostat 5 ohms"),
      text("outlet-power", "Power received (outlet)"),
      choice("vent-fan", "Vent fan functioning", ["Yes", "No"]),
      choice("cooling-fan", "Cooling fan functioning", ["Yes", "No"]),
      text("switch-1-open", "Micro switch 1 ohms — open"),
      text("switch-1-closed", "Micro switch 1 ohms — closed"),
      text("switch-2-open", "Micro switch 2 ohms — open"),
      text("switch-2-closed", "Micro switch 2 ohms — closed"),
      text("switch-3-open", "Micro switch 3 ohms — open"),
      text("switch-3-closed", "Micro switch 3 ohms — closed"),
      text("switch-4-open", "Micro switch 4 ohms — open"),
      text("switch-4-closed", "Micro switch 4 ohms — closed"),
      text("capacitor", "Capacitor uF"),
      text("magnetron", "Magnetron resistance"),
      text("transformer", "Transformer resistance"),
    ],
  },
];

/** Same model-number fallback Repair Knowledge / the ticket lists use when Product Category is blank. */
const MODEL_GUESSES: Array<[RegExp, string]> = [
  [/dryer/, "Dryer"],
  [/washer|washing/, "Washer"],
  [/refrig|fridge/, "Refrigerator"],
  [/dishwash/, "Dishwasher"],
  [/range|stove|oven|cooktop/, "Range"],
  [/microwave/, "Microwave"],
  [/ice\s*maker/, "Ice Maker"],
];

const norm = (s: string) => s.trim().toLowerCase();

/** Guides that cover this ticket's product (a "Washer Dryer" gets both). */
export function guidesForProduct(guides: TechGuide[], productType: string | null | undefined, model?: string | null): TechGuide[] {
  let product = norm(productType || "");
  if (!product) {
    const m = norm(model || "");
    product = norm(MODEL_GUESSES.find(([re]) => re.test(m))?.[1] ?? "");
  }
  if (!product) return [];
  return guides.filter((g) => g.productCategories.some((c) => norm(c) === product));
}

/** Section ids whose keywords appear in the symptom text, best match first. */
export function sectionsMatchingSymptom(guide: TechGuide, symptom: string | null | undefined): string[] {
  const s = norm(symptom || "");
  if (!s) return [];
  return guide.sections
    .map((sec) => ({ id: sec.id, hits: sec.keywords.filter((k) => k && s.includes(norm(k))).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((x) => x.id);
}

/** Stable key for a ticked step in saved readings — text-based so reordering steps doesn't shift ticks. */
export const stepKey = (sectionId: string, step: string) => `step:${sectionId}:${step}`;
