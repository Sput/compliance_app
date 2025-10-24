export default function ProfileViewPage() {
  // For now, show a placeholder since we're not using Supabase auth helpers
  return (
    <div className='flex w-full flex-col space-y-2 p-4'>
      <p className='font-medium'>Profile Page</p>
      <p className='text-muted-foreground text-sm'>
        Authentication not configured
      </p>
    </div>
  );
}
