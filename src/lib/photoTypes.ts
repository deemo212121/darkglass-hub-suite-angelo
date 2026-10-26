/**
 * Ticket photo types — what each photo in a ticket's Attachments shows. The
 * type is saved with the photo (Firebase Storage custom metadata
 * "photoType"), so the folder, Pre-Claim and the mobile app keep working
 * unchanged. Photos uploaded before types existed simply have none.
 *
 * Required ones are checked by the ticket's Claims Readiness.
 */
export interface PhotoTypeDef {
  key: string;
  label: string;
  required: boolean;
  /** What the photo must show — shown under the label. */
  help: string;
}

export const PHOTO_TYPES: PhotoTypeDef[] = [
  {
    key: "model_serial",
    label: "Model and Serial Number",
    required: true,
    help: "One photo showing both the appliance's model number and serial number together. Both must be clearly visible and readable.",
  },
  {
    key: "before_work",
    label: "Before-Work Photo",
    required: true,
    help: "The appliance before any work begins, documenting its condition upon arrival.",
  },
  {
    key: "after_work",
    label: "After-Work Photo",
    required: true,
    help: "The appliance after the repair or service has been completed, showing its final condition.",
  },
  {
    key: "invoice",
    label: "Invoice / Repair Order",
    required: true,
    help: "The completed invoice or repair order containing the correct and required information for this ticket.",
  },
  {
    key: "floor_mats",
    label: "Floor Mats",
    required: false,
    help: "The floor mats being used to protect the customer's home during the visit — expected at every ticket, stop and customer home visit.",
  },
  {
    key: "physical_damage",
    label: "Existing Physical Damage",
    required: false,
    help: "If any physical damage is seen on the appliance: clear photos of it before beginning work whenever possible, showing the location and extent of the damage.",
  },
  {
    key: "part_replaced",
    label: "Part Being Replaced",
    required: false,
    help: "The existing part currently installed that will be replaced — taken before the original part is removed.",
  },
  {
    key: "infestation",
    label: "Signs of Infestation",
    required: false,
    help: "Any signs of pests on or around the appliance — insects, rodents, droppings, nests, eggs or other visible activity. Document the affected areas before beginning work whenever possible.",
  },
];

export const REQUIRED_PHOTO_TYPES = PHOTO_TYPES.filter((t) => t.required);

export function photoTypeLabel(key: string | null | undefined): string {
  return PHOTO_TYPES.find((t) => t.key === key)?.label ?? "";
}

/** Required photo types not covered by the given photos' types. */
export function missingRequiredPhotoTypes(types: (string | null | undefined)[]): PhotoTypeDef[] {
  const have = new Set(types.filter(Boolean));
  return REQUIRED_PHOTO_TYPES.filter((t) => !have.has(t.key));
}
