import { redirect } from "next/navigation";

export default function BatchImportPage() {
  redirect("/books/import?auto=1");
}
