import { manifestXml } from "@/lib/excel/manifest";
import { publicBaseUrl } from "@/lib/service";

export const dynamic = "force-dynamic";

/** The file people upload into Excel to load the Uprali add-in. */
export async function GET(req: Request) {
  return new Response(manifestXml(publicBaseUrl(req)), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": 'attachment; filename="uprali-excel-manifest.xml"',
      "cache-control": "no-store",
    },
  });
}
