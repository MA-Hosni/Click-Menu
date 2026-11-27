import { redirect } from "next/navigation";

export default function QrPage(): never {
  return redirect("/admin/tables");
}
