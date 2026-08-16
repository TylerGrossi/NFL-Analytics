import { redirect } from "next/navigation";
import { Empty, SectionRule } from "@/components/ui";
import { getPlayedWeeks } from "@/lib/queries";

export const metadata = { title: "This week" };
export const revalidate = 900;

/** `/week` is the stable link; it always lands on the newest completed week. */
export default async function WeekIndex() {
  const weeks = await getPlayedWeeks();
  if (weeks.length === 0) {
    return (
      <>
        <SectionRule>This week</SectionRule>
        <Empty>No completed games in the store yet.</Empty>
      </>
    );
  }
  redirect(`/week/${weeks[0].season}/${weeks[0].week}`);
}
