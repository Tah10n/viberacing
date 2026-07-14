import { connection } from "next/server";

import { RaceExperience } from "@/components/race-experience";
import { getSyntheticRacePayload } from "@/lib/race-data";

export default async function HomePage() {
  await connection();
  const payload = getSyntheticRacePayload();
  return <RaceExperience payload={payload} />;
}
