'use client';

import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardFooter
} from '@/components/ui/card';
import { IconTrendingDown, IconTrendingUp } from '@tabler/icons-react';
import React, { useState, useEffect } from 'react';

export default function OverViewLayout({
  sales,
  pie_stats,
  bar_stats,
  area_stats
}: {
  sales: React.ReactNode;
  pie_stats: React.ReactNode;
  bar_stats: React.ReactNode;
  area_stats: React.ReactNode;
}) {
  const [personal_finance_data, setPersonalFinanceData] = useState({
    total_assets: 0
  });

  useEffect(() => {
    const fetchFinanceData = async () => {
      try {
        const response = await fetch('/api/python', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'run_script',
            script: 'personal_finance_data.py',
            data: {
              args: ['--data', '{}']
            }
          })
        });

        const result = await response.json();
        console.log('Finance data result:', result);
        if (result.success && result.data) {
          setPersonalFinanceData(result.data);
        } else {
          console.error('Failed to fetch finance data:', result);
        }
      } catch (error) {
        console.error('Error fetching finance data:', error);
      }
    };

    fetchFinanceData();
  }, []);
  return (
    <PageContainer>
      <div className='flex flex-1 flex-col space-y-2'>
        <div className='flex items-center justify-between space-y-2'>
          <h2 className='text-2xl font-bold tracking-tight'>
            Hi, Welcome back 👋
          </h2>
        </div>

        {/* Removed overview stat cards */}
        {/* <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-7'>
          <div className='col-span-4'>{bar_stats}</div>
          <div className='col-span-4 md:col-span-3'>
            sales parallel routes
            {sales}
          </div>
          <div className='col-span-4'>{area_stats}</div>
          <div className='col-span-4 md:col-span-3'>{pie_stats}</div>
        </div> */}
      </div>
    </PageContainer>
  );
}
