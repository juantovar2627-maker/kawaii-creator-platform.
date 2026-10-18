import type { MetadataRoute } from 'next';
import { appMode } from '@/lib/config/runtime';
export const dynamic = 'force-dynamic';
export default function robots(): MetadataRoute.Robots {
  return {rules:{userAgent:'*',disallow:appMode()==='staging'?'/':['/dashboard/','/admin/','/api/']}};
}
