// Hand grading of the plain-English lines Gemma 4 E2B wrote for the six test
// documents in bench-results.json. Every flagged sentence (77 of them) was read
// against its quote. The entries below are the ones judged wrong; anything not
// listed was judged an accurate reading.
//   kind "direction": the line reverses or blurs who pays whom, or names the wrong party
//   kind "other":     garbled, invents a penalty, or changes the requirement
export const WRONG = [
  { doc: "three-rivers", starts: "Time beyond that is billable", kind: "direction" },
  { doc: "three-rivers", starts: "For an expedited payment", kind: "direction" },
  { doc: "three-rivers", starts: "Carrier waives any right", kind: "other" },
  { doc: "cedar-gap", starts: "Cedar Gap pays for excessive", kind: "direction" },
  { doc: "cedar-gap", starts: "Remittance is made within", kind: "direction" },
  { doc: "northline", starts: "Carrier will be paid $30", kind: "direction" },
  { doc: "northline", starts: "A 3% discount applies", kind: "direction" },
  { doc: "bluebonnet", starts: "Original signed delivery documents", kind: "other" },
  { doc: "granite-pass", starts: "Detention begins after two hours", kind: "direction" },
  { doc: "granite-pass", starts: "Detention will not be paid unless", kind: "direction" },
  { doc: "sawgrass", starts: "Trucks will not be received", kind: "other" },
  { doc: "sawgrass", starts: "Detention is included in the rate", kind: "direction" },
  { doc: "sawgrass", starts: "Sawgrass does not pay truck ordered", kind: "other" },
];
