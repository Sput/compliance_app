"use client";

import React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from '@/components/ui/chart';
import { Bar, BarChart, CartesianGrid, Pie, PieChart, XAxis, Label, Tooltip } from 'recharts';

type DailyCount = { day: string; count: number };
type KV = { name: string; value: number };

export default function EvidenceGraphs({
  dailyCounts,
  fileTypes,
  statuses,
  uploadsTotal,
}: {
  dailyCounts: DailyCount[];
  fileTypes: KV[];
  statuses: KV[];
  uploadsTotal: number;
}) {
  const totalUploads = dailyCounts.reduce((a, b) => a + (b.count || 0), 0);
  const totalByType = fileTypes.reduce((a, b) => a + (b.value || 0), 0);
  const totalByStatus = statuses.reduce((a, b) => a + (b.value || 0), 0);

  return (
    <div className="mx-auto max-w-6xl p-4 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className='@container/card'>
          <CardHeader>
            <CardTitle>Total Evidence Uploads</CardTitle>
            <CardDescription>All-time uploads</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-semibold tabular-nums">{uploadsTotal.toLocaleString()}</div>
          </CardContent>
        </Card>
        <div className="md:col-span-2" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className='@container/card'>
          <CardHeader>
            <CardTitle>Evidence Uploads (Last 30 Days)</CardTitle>
            <CardDescription>Total uploads: {totalUploads}</CardDescription>
          </CardHeader>
          <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
            <ChartContainer config={{}} className="w-full h-[320px] aspect-auto items-stretch justify-start">
              <BarChart data={dailyCounts} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                  tickFormatter={(v: string) => v.slice(5)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className='@container/card'>
          <CardHeader>
            <CardTitle>File Types</CardTitle>
            <CardDescription>Total files: {totalByType}</CardDescription>
          </CardHeader>
          <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
            <ChartContainer config={{}} className="w-full h-[320px] aspect-auto items-stretch justify-start">
              <PieChart>
                <Tooltip content={<ChartTooltipContent hideLabel />} />
                <Pie data={fileTypes} dataKey="value" nameKey="name" innerRadius={60} strokeWidth={2} stroke="var(--background)" />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card className='@container/card'>
        <CardHeader>
          <CardTitle>Evidence Statuses</CardTitle>
          <CardDescription>Total: {totalByStatus}</CardDescription>
        </CardHeader>
        <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
          <ChartContainer config={{}} className="w-full h-[320px] aspect-auto items-stretch justify-start">
            <PieChart>
              <Tooltip content={<ChartTooltipContent hideLabel />} />
              <Pie data={statuses} dataKey="value" nameKey="name" innerRadius={60} strokeWidth={2} stroke="var(--background)" />
            </PieChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
