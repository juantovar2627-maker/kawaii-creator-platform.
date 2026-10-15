import { Notifications } from "@/components/community/notifications";
import { DemoNotice, PageIntro } from "@/components/community/primitives";

export const metadata = { title: "Notifications" };
export default function NotificationsPage() {
  return (
    <>
      <PageIntro
        eyebrow="LITTLE NOTES FROM YOUR WORLD"
        title="A little hello."
        description="A preview of the thoughtful moments a connected community could bring."
      />
      <DemoNotice>
        These are sample notifications, not activity from real accounts. Live
        notifications are not connected yet.
      </DemoNotice>
      <Notifications />
    </>
  );
}
