import { redirect } from "next/navigation";

/** Group-root redirect — `/gst` lands on the first leaf so the
 *  GST Returns sidebar header doesn't 404 when clicked / typed. */
export default function GstIndex() {
  redirect("/gst/gstr-1");
}
