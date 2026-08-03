import { redirect } from "next/navigation";

export default async function SharingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/draft/${id}?sharing=1`);
}
