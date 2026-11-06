import { createCn } from "cn/config";

const TYPE_FAMILIES = [
  "large-title", "display-1", "display-2", "display-3", "display-4",
  "title-1", "title-2", "title-3", "headline", "body", "body-2",
  "caption-1", "caption-2",
] as const;
const TYPE_WEIGHTS = ["regular", "medium", "semibold", "bold"] as const;

/** Persora composites are font-size/line-height families, never text colors. */
const TYPE_COMPOSITE_VALUES = TYPE_FAMILIES.flatMap((family) =>
  TYPE_WEIGHTS.map((weight) => `${family}-${weight}`),
);

export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: TYPE_COMPOSITE_VALUES }],
    },
  },
});
