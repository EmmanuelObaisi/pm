const accents = [
  "#209dd7",
  "#753991",
  "#ecad0a",
  "#12a594",
  "#e0576b",
];

export const columnAccent = (index: number) => accents[index % accents.length];
