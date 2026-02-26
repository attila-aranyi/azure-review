export const simpleDiffBefore = `function greet(name) {
  return "Hello, " + name;
}
`;

export const simpleDiffAfter = `function greet(name: string) {
  return \`Hello, \${name}\`;
}

function farewell(name: string) {
  return \`Goodbye, \${name}\`;
}
`;

export const binaryContentBefore = "some\u0000binary\u0000content";
export const binaryContentAfter = "some\u0000binary\u0000content\u0000changed";

export const largeFileBefore = "x".repeat(250_000);
export const largeFileAfter = "x".repeat(250_000) + "\nnew line";

export const identicalContent = `function noop() {
  return;
}
`;

export const multiHunkBefore = `line1
line2
line3
line4
line5
line6
line7
line8
line9
line10
line11
line12
line13
line14
line15
line16
line17
line18
line19
line20
`;

export const multiHunkAfter = `line1
changed2
line3
line4
line5
line6
line7
line8
line9
line10
line11
line12
line13
line14
line15
line16
line17
line18
changed19
line20
`;
