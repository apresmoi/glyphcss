import { heroRule } from "../../features/home/heroRule";
import { howItWorksDiagram } from "../../features/home/howItWorks";
import { AsciiArt } from "../AsciiArt";
const compositions = { heroRule: heroRule(), howItWorksDiagram: howItWorksDiagram() };
export function HomeAsciiArt({
  factory,
  ...props
}: {
  factory: keyof typeof compositions;
  className?: string;
  minCols?: number;
  maxCols?: number;
  ariaLabel?: string;
}) {
  return <AsciiArt composition={compositions[factory]} {...props} />;
}
