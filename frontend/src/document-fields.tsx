import { useForm } from '@mantine/form';
import { TextInput, Textarea, Select, SimpleGrid } from '@mantine/core';
import { Row } from './core';
export const emptyDocument: Row = {
  title: '',
  category: 'Bauplan',
  area: 'Allgemein',
  status: 'Aktuell',
  tags: '',
  description: '',
};
export function DocumentFields({
  form,
  options,
  fixedArea,
}: {
  form: ReturnType<typeof useForm<Row>>;
  options: Row;
  fixedArea?: string;
}) {
  return (
    <>
      <TextInput label="Titel" required maxLength={200} {...form.getInputProps('title')} />
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Select
          label="Kategorie"
          data={options.categories || []}
          {...form.getInputProps('category')}
        />
        <Select
          label="Bereich"
          disabled={!!fixedArea}
          data={options.areas || []}
          {...form.getInputProps('area')}
        />
        <Select label="Status" data={options.statuses || []} {...form.getInputProps('status')} />
        <TextInput label="Schlagworte" maxLength={400} {...form.getInputProps('tags')} />
      </SimpleGrid>
      <Textarea
        label="Beschreibung"
        maxLength={1500}
        minRows={3}
        {...form.getInputProps('description')}
      />
    </>
  );
}
