import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ProfileDetails } from './ProfileDetails';
afterEach(cleanup);
it('renders the reference website label and birthday with a safe external link', () => {
  render(<ProfileDetails websiteUrl="https://lit.link/key_trend" birthDate="1998-05-10" />);
  expect(screen.getByRole('link', {name: 'lit.link/key_trend'})).toHaveAttribute('href', 'https://lit.link/key_trend');
  expect(screen.getByRole('link')).toHaveClass('text-primary');
  expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByText('誕生日: 1998年5月10日')).toBeInTheDocument();
});
it('omits empty fields and invalid stored values', () => {
  const {container, rerender} = render(<ProfileDetails />);
  expect(container).toBeEmptyDOMElement();
  rerender(<ProfileDetails websiteUrl="javascript:alert(1)" birthDate="1998-02-30" />);
  expect(container).toBeEmptyDOMElement();
});

it('keeps the Japanese and uppercase URL label while retaining the theme and inherited text size', () => {
  render(<ProfileDetails websiteUrl="HTTPS://Example.COM/日本語?Key=Value" birthDate="1998-05-10" />);
  const link=screen.getByRole('link',{name:'Example.COM/日本語?Key=Value'});
  expect(link).toHaveAttribute('href','HTTPS://Example.COM/日本語?Key=Value');
  expect(link).toHaveClass('text-primary');
  expect(link).toHaveStyle({fontSize:'inherit',lineHeight:'inherit'});
});
