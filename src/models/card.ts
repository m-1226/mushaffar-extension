export interface CardModel {
  id: string;
  cardName: string;
  cardNumber: string;
  cardholderName: string;
  expiryDate: string; // MM/YY
  cvv: string;
  cardType?: string;
  createdDate: string;
  lastEditDate: string;
  bankName?: string;
  bankUrl?: string;
  brandColor?: number;
}

export function maskedCardNumber(card: CardModel): string {
  const num = card.cardNumber.replace(/\s/g, '');
  if (num.length < 4) return num;
  return `•••• ${num.slice(-4)}`;
}

export function lastFourDigits(card: CardModel): string {
  return card.cardNumber.replace(/\s/g, '').slice(-4);
}
