<?php

declare(strict_types=1);

namespace Catalog\Application\Message\Query\GetBook;

use Catalog\Domain\Exception\BookNotFoundException;
use Catalog\Domain\Repository\BookRepositoryInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(bus: 'command.bus')]
final readonly class GetBookHandler
{
    public function __construct(
        private BookRepositoryInterface $bookRepository,
    ) {
    }

    public function __invoke(GetBook $query): BookView
    {
        $book = $this->bookRepository->findById($query->id);

        if (null === $book) {
            throw new BookNotFoundException($query->id);
        }

        return BookView::fromBook($book);
    }
}
